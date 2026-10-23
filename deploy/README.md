# Деплой Guldala (CRM + сайт)

Один VPS в Казахстане, один Docker Compose (спека §15): Postgres, миграции, CRM, сайт, Caddy с HTTPS, ежедневный бэкап.

```
интернет ─▶ caddy :80/:443 (Let's Encrypt) ─┬─ crm.DOMAIN ─────────────▶ app :3001 ─▶ postgres
                                            └─ DOMAIN, botanica.DOMAIN ─▶ site :3000    │
                                       migrate (при старте) ─┘   backup (03:00 → deploy/backups) ─┘
```

## Первый запуск

Нужно: VPS с Docker и Compose v2, A-записи `DOMAIN`, `crm.DOMAIN` и `botanica.DOMAIN` на IP сервера, открытые порты 80 и 443. Сборке двух Next нужна память: при 2 ГБ RAM — swap 2 ГБ.

Оба репозитория клонируются рядом: compose собирает сайт из `../../site`. Репозитории приватные — серверу по deploy-ключу на каждый (только чтение; GitHub не принимает один ключ в двух репозиториях): `ssh-keygen -t ed25519 -N "" -f ~/.ssh/guldala_crm` (и `guldala_site`), в `~/.ssh/config` — `Host github-guldala-crm` / `github-guldala-site` с `HostName github.com` и своим `IdentityFile`, публичные ключи — `gh repo deploy-key add`.

```bash
mkdir /opt/guldala && cd /opt/guldala
git clone git@github-guldala-crm:JustContestIt/guldala-crm.git crm
git clone git@github-guldala-site:JustContestIt/guldala-site.git site
cd crm/deploy
cp .env.example .env          # заполнить: DOMAIN, POSTGRES_PASSWORD, SESSION_SECRET, WAZZUP_* (openssl rand -hex 32)
docker compose up -d --build  # сборка 5–10 минут; миграции применяются сами перед стартом приложения
docker compose run --rm migrate npx tsx scripts/create-user.ts tatiana "Татьяна"
```

`WAZZUP_CHANNEL_ID` — `channelId` активного канала из `GET https://api.wazzup24.com/v3/channels` (с тем же Bearer-ключом).

Последняя команда печатает пароль один раз. Ей же сбрасывается забытый пароль. Дальше вход на `https://crm.DOMAIN`, создание сезона, цвета и сетка цен — в «Ещё → Сезоны».

### Если 80/443 уже занимает другой Caddy в Docker

Так на временном сервере (VPS Артёма: его Caddy и n8n в `/opt/stack`, сеть `stack_web`). Наш `caddy` не запускается, `app` и `site` подключаются к его сети — файл `deploy/docker-compose.override.yml` только на сервере, compose подхватывает его сам:

```yaml
services:
  caddy: { profiles: [off] }
  app:  { networks: { default: {}, web: { aliases: [guldala-crm] } } }
  site: { networks: { default: {}, web: { aliases: [guldala-site] } } }
networks:
  web: { name: stack_web, external: true }
```

В его Caddyfile — те же три хоста, что в нашем, с прокси на `guldala-site:3000` и `guldala-crm:3001`; файл примонтирован по одному, поэтому дописывать на месте (`tee -a`), не заменять, затем `docker exec stack-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.

## Обновление

```bash
cd /opt/guldala/crm/deploy
git -C .. pull && git -C ../../site pull && docker compose up -d --build
```

Пересобирается и перезапускается только то, что изменилось. Новые миграции из `db/migrations/` применятся сами до старта новой версии CRM. Если миграция упала, новая версия CRM не запустится — смотреть `docker compose logs migrate`.

Смена домена: новые A-записи → `DOMAIN` в `.env` → `docker compose up -d`. Caddy сам получит сертификаты. Адрес для canonical, sitemap и OG у сайта пока зашит в `site/content/site.ts`.

## Каждый день

| Что | Команда |
|---|---|
| Логи CRM / сайта | `docker compose logs -f app` / `docker compose logs -f site` |
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
| `docker-compose.yml` | Все службы. База наружу не открыта, CRM и сайт — только через Caddy |
| `Caddyfile` | HTTPS для `DOMAIN`, `crm.` и `botanica.`; прокси на сайт и CRM |
| `backup.sh` | Ежедневный `pg_dump` и чистка старше 30 дней |
| `.env` | Секреты. Не коммитится и не попадает в образ |

`scripts/seed.ts` в этом окружении отказывается работать (`NODE_ENV=production`) — он стирает базу.
