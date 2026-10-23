# Деплой Guldala CRM

Один VPS, Docker Compose (спека §15): Postgres, миграции, приложение, Caddy с HTTPS, ежедневный бэкап.

```
интернет ─▶ caddy :80/:443 (Let's Encrypt) ─▶ app :3001 ─▶ postgres
                                      migrate (при старте) ─┘     └─ backup (03:00 → deploy/backups)
```

## Первый запуск

Нужно: VPS с Docker и Compose v2, A-запись домена на IP сервера, открытые порты 80 и 443. Сборке Next нужна память: на VPS с 1 ГБ добавьте swap.

```bash
# на сервере, в копии папки crm/
cd deploy
cp .env.example .env          # заполнить: DOMAIN, POSTGRES_PASSWORD, SESSION_SECRET (openssl rand -hex 32)
docker compose up -d --build  # сборка 3–5 минут; миграции применяются сами перед стартом приложения
docker compose run --rm migrate npx tsx scripts/create-user.ts tatiana "Татьяна"
```

Последняя команда печатает пароль один раз. Ей же сбрасывается забытый пароль. Дальше вход на `https://DOMAIN`, создание сезона, цвета и сетка цен — в «Ещё → Сезоны».

## Обновление

```bash
git pull                      # или скопировать новую версию crm/
cd deploy && docker compose up -d --build
```

Новые миграции из `db/migrations/` применятся сами до старта новой версии. Если миграция упала, новая версия приложения не запустится — смотреть `docker compose logs migrate`.

## Каждый день

| Что | Команда |
|---|---|
| Логи приложения | `docker compose logs -f app` |
| Логи вызовов Wazzup | `docker compose logs app \| grep wazzup` |
| Состояние | `docker compose ps` |
| Бэкап прямо сейчас | `docker compose exec backup sh /backup.sh now` |

## Бэкапы

Каждый день в 03:00 по Алматы — `deploy/backups/guldala-ГГГГ-ММ-ДД.dump`, хранятся 30 дней.

**Они лежат на том же сервере.** Если умрёт диск VPS, пропадут вместе с базой — копируйте папку куда-то ещё (хотя бы `scp` к себе раз в неделю).

Восстановление (затирает текущие данные):

```bash
docker compose stop app
docker compose exec -T postgres pg_restore -U guldala -d guldala --clean --if-exists --no-owner < backups/guldala-2027-03-05.dump
docker compose start app
```

## Что где

| Файл | Зачем |
|---|---|
| `../Dockerfile` | `builder` — сборка и инструменты (миграции, `create-user`); `runner` — только standalone-сервер Next |
| `docker-compose.yml` | Все службы. База наружу не открыта, приложение — только через Caddy |
| `Caddyfile` | HTTPS для `DOMAIN` и прокси на приложение |
| `backup.sh` | Ежедневный `pg_dump` и чистка старше 30 дней |
| `.env` | Секреты. Не коммитится и не попадает в образ |

`scripts/seed.ts` в этом окружении отказывается работать (`NODE_ENV=production`) — он стирает базу.
