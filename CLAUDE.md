# Guldala CRM

Спецификация продукта: `../GULDALA_CRM_SPEC.md` — источник правды. Расхождение кода и спеки — ошибка в коде.
Стек (решение этапа 0, спека §15, вариант «один Next.js»): Next.js 16 App Router + Drizzle + Postgres 16. Роль `packages/shared` играет `lib/` (чистые функции), роль `apps/api` — `services/` + server actions.

- Язык UI — русский. Деньги — integer ₸. Таймзона — Asia/Almaty. Телефоны — E.164.
- Всё, что в спеке помечено [ДОПУЩЕНИЕ], живёт в `seasons.settings` (`lib/settings.ts`), не в хардкоде.
- Расчёт цены, остатков, предоплаты — только через `lib/calc.ts`; UI и сервисы не дублируют формулы.
- Любое изменение статуса или денег — через `services/orders.ts` с записью в `order_events`.
- WhatsApp — только через `integrations/` за интерфейсом `MessagingProvider`; прямых вызовов Meta/WhatsApp нет; своего инбокса нет.
- Исходящие клиентам — только тем, у кого есть заказ или переписка; массовых рассылок через API нет.
- Не добавлять экраны, поля и статусы, которых нет в спеке, без вопроса.
- Каждая страница и server action вызывает `requireUser()` / `requireOwner()`: `proxy.ts` не прикрывает server actions.
- Схема БД меняется через `db/schema.ts` → `npm run db:generate` → миграция в `db/migrations/` в коммит.
- Перед коммитом: `npm test` (unit в `lib/`, интеграционные в `services/` на `TEST_DATABASE_URL`, фейковый провайдер).

@AGENTS.md
