# CRM АвтоПлан — справочник администратора

> **Хранить в репозитории.** Единый файл с картой всей CRM: модули, API, БД, роли, env, команды и эксплуатация.  
> Для пользователей — [AVITOPLAN-USER-GUIDE.md](./knowledge-base/AVITOPLAN-USER-GUIDE.md). Для Cloud Agents — [AGENTS.md](../AGENTS.md).

---

## 1. Что это

**CRM АвтоПлан** — SaaS-CRM для автосервисов и магазинов запчастей.

| Слой | Путь | Технологии |
|------|------|------------|
| Frontend | `src/` | React 19, wouter, TanStack Query |
| API | `api/` | Hono, Drizzle ORM |
| БД | `crm.db` или PostgreSQL | SQLite (dev/legacy) / PG (prod SaaS) |
| Сервер | `server.ts`, `server.prod.ts` | Node 20+, WebSocket `/api/ws` |
| E2E | `e2e/` | Playwright |

Продакшен: PM2 + Nginx + HTTPS. Основной домен: `https://crmavito.online`.

---

## 2. Модули интерфейса (страницы)

| Раздел | URL | Страница | Кому |
|--------|-----|----------|------|
| Входящие | `/` | `src/pages/inbox.tsx` | все |
| Дашборд | `/dashboard` | `src/pages/dashboard.tsx` | все |
| AI-боты | `/assistant` | `src/pages/assistant.tsx` | все |
| Команда (чат) | `/team` | `src/pages/team-chat.tsx` | все |
| Клиенты | `/clients` | `src/pages/clients.tsx` | все |
| Заказы | `/deals` | `src/pages/deals.tsx` | все |
| Заказ-наряды | `/zn`, `/zn/:id` | `src/pages/zn.tsx` | все |
| Реализация | `/sales` | `src/pages/sales.tsx` | все |
| Доставка (СДЭК) | `/delivery` | `src/pages/delivery.tsx` | все |
| Деньги | `/money`, `/money/:section` | `src/pages/money.tsx` | все (UI scaffold; flyout в `nav.ts`) |
| Склад | `/warehouse` | `src/pages/warehouse.tsx` | все |
| Выкуп | `/buyouts` | `src/pages/buyouts.tsx` | все |
| ZZap | `/zzap` | `src/pages/zzap.tsx` | все |
| Календарь | `/calendar` | `src/pages/calendar.tsx` | все |
| Запись на ремонт | `/repairs`, `/service` | `src/pages/repairs.tsx` | все |
| Задачи | `/tasks` | `src/pages/tasks.tsx` | все |
| Звонки | `/calls` | `src/pages/calls.tsx` | все |
| Рассылки | `/marketing` | `src/pages/marketing.tsx` | все |
| Отчёты | `/analytics` | `src/pages/analytics.tsx` | **admin** |
| Расчёт ЗП | `/payroll` | `src/pages/payroll.tsx` | **admin** |
| Настройки | `/settings` | `src/pages/settings.tsx` | все |
| Зарплата (сотрудник) | `/my-salary` | `src/pages/my-salary.tsx` | все |

**API only / UI нет в текущем билде:** `/procurement`, `/gantt`, `/team-activity`, `/admin/billing`, `/book` (публичная запись — API `/api/public`).

**Настройки — вкладки:** themes, security, alerts, tags, templates, users, channels, general, telephony, cdek, ai, sales.

Маршруты: `src/app.tsx`. Меню: `src/lib/nav.ts` → `src/components/Sidebar.tsx`.

---

## 3. Роли

| Роль | `users.role` | Доступ |
|------|--------------|--------|
| **admin** | `admin` | Всё + отчёты, ЗП, пользователи, интеграции |
| **operator** | `operator` | Чаты, клиенты, заказы, ЗН, склад |
| **demo** | `demo` | Только просмотр; часть разделов скрыта |

Admin-пункты меню скрываются через `adminOnly` в `src/lib/nav.ts` / `Sidebar`. API: `requireAdmin` в `api/middleware/auth.ts`. Отдельного `AdminRoute` в `app.tsx` нет — общий `ProtectedRoute`.

---

## 4. API (префикс `/api`)

Регистрация: `api/index.ts`.

| Группа | Путь | Файл |
|--------|------|------|
| Auth | `/auth` | `api/routes/auth.ts` |
| Клиенты | `/clients` | `api/routes/clients.ts` |
| Диалоги | `/conversations` | `api/routes/conversations.ts` |
| Заказы/ЗН | `/deals` | `api/routes/deals.ts` |
| ЗН labor/items | `/orders` | `api/routes/orders.ts` |
| СТО расшир. | `/sto`, `/sto/inventory` | `api/routes/sto-extended.ts`, `sto-inventory.ts` |
| Склад/запчасти | `/parts` | `api/routes/parts.ts` |
| Реализация | `/sales` | `api/routes/sales.ts` |
| Проценка | `/procurement` | `api/routes/procurement.ts` |
| Заказы поставщикам | `/supplier-orders` | `api/routes/supplier-orders.ts` |
| Запись/ремонт | `/service` | `api/routes/service.ts` |
| Задачи | `/tasks` | `api/routes/tasks.ts` |
| AI | `/ai` | `api/routes/ai.ts` |
| Каналы | `/channels` | `api/routes/channels.ts` |
| Avito | `/avito` | `api/routes/avito.ts` |
| Webhooks | `/webhooks` | `api/routes/webhooks.ts` |
| Звонки/телефония | `/calls`, `/telephony` | `api/routes/calls.ts`, `telephony.ts` |
| СДЭК | `/cdek` | `api/routes/cdek.ts` |
| ZZap | `/zzap` | `api/routes/zzap.ts` |
| Выкуп | `/buyouts` | `api/routes/buyouts.ts` |
| Рассылки | `/broadcasts` | `api/routes/broadcasts.ts` |
| Команда (чат) | `/team-chat` | `api/routes/team-chat.ts` |
| Активность | `/team-activity` | `api/routes/team-activity.ts` |
| ЗП | `/payroll` | `api/routes/payroll.ts` |
| Аналитика | `/analytics` | `api/routes/analytics.ts` |
| Настройки CRM | `/crm/settings` | `api/routes/crm-settings.ts` |
| Пользователи | `/users` | `api/routes/users.ts` |
| Tenants (SaaS) | `/tenants` | `api/routes/tenants.ts` |
| Admin биллинг | `/admin/billing` | `api/routes/admin/billing.ts` |
| Admin клиенты | `/admin/clients` | `api/routes/admin/clients.ts` |
| Stripe webhook | `/webhooks/stripe` | `api/routes/webhooks/stripe.ts` |
| Импорт/экспорт | `/imports`, `/export` | `api/routes/imports.ts`, `export.ts` |
| Интеграции | `/integrations` | `api/routes/integrations.ts` |
| Публичная запись | `/public` | `api/routes/public-booking.ts` |
| Health | `/health` | `api/index.ts` |
| Metrics | `/metrics` | Prometheus (нужен `METRICS_TOKEN` в prod) |

---

## 5. База данных (основные таблицы)

Схема: `api/database/schema.ts`.

| Домен | Таблицы |
|-------|---------|
| SaaS | `tenants`, `subscription_plans`, `tenant_subscriptions`, `invoices`, `tenant_usage`, `audit_logs` |
| Пользователи | `users`, `sessions`, `user_login_sessions`, `user_activity_events` |
| CRM ядро | `clients`, `vehicles`, `tags`, `client_tags`, `client_comments` |
| Коммуникации | `channels`, `conversations`, `messages`, `notifications` |
| Заказы | `deals`, `order_items`, `deal_labor_items`, `sales_documents`, `sales_document_items` |
| СТО | `service_appointments`, `service_schedule`, `service_settings`, `sto_enterprises` |
| Склад | `parts_stock` |
| Задачи | `tasks`, `task_comments` |
| Звонки | `call_logs`, `telephony_settings` |
| Доставка | `cdek_settings` (+ shipments в runtime) |
| ZZap | `zzap_settings`, `zzap_price_lists` |
| Выкуп | `parts_buyouts` |
| AI | `ai_proposals` |
| Команда | `team_chat_groups`, `team_chat_members`, `team_chat_messages`, `activity_log` |
| ЗП | `payroll_roles`, `payroll_rules`, `payroll_calculations`, `payroll_calculation_lines` |
| Прочее | `quick_templates`, `broadcasts`, `crm_settings`, `report_daily_overrides`, `api_keys`, `tenant_webhooks`, `webhook_logs`, `support_tickets`, `ticket_replies` |

**Изоляция данных:** каждая строка с `tenant_id`. Middleware: `api/middleware/tenant.ts`, `api/lib/tenant-query.ts`.

---

## 6. Фоновые процессы (server.ts)

| Сервис | Файл | Назначение |
|--------|------|------------|
| Avito polling | `api/services/avito-poll.ts` | Синхронизация чатов |
| Telegram polling | `api/services/telegram-poll.ts` | Telegram-боты |
| Task reminders | `api/services/task-reminders.ts` | Напоминания по задачам |
| Appointment reminders | `api/services/appointment-reminders.ts` | Запись на СТО |
| CDEK polling | `api/services/cdek-poll.ts` | Статусы доставки |
| Avito CPA monitor | `api/services/avito-cpa-monitor.ts` | Мониторинг CPA |
| ZZap upload | `api/services/zzap-upload.ts` | Выгрузка прайсов |
| Conv preview reconcile | `api/services/conv-preview-reconcile.ts` | Починка превью диалогов (каждые 30 мин) |
| Unread reconcile | `api/lib/unread-reconcile.ts` | Синхронизация непрочитанных (при старте) |
| Chat SLA | `api/services/chat-sla-reminders.ts` | SLA входящих |
| Session cleanup | `api/services/session-cleanup.ts` | Очистка сессий |
| WebSocket | `api/services/ws.ts` | Real-time UI |

---

## 7. Переменные окружения (ключевые)

Шаблон: `scripts/templates/client-env.example`, `.env.example`.

| Переменная | Назначение |
|------------|------------|
| `PUBLIC_URL` | HTTPS-URL CRM (webhooks, cookies) |
| `NODE_ENV` | `production` на сервере |
| `AUTH_SALT` | Соль паролей (уникальна на инсталляцию) |
| `CRM_DB_PATH` | Путь к SQLite (если не PG) |
| `DATABASE_URL` | PostgreSQL (SaaS/prod) |
| `INSTALL_SECRET` | Защита `/api/seed` в prod |
| `TENANT_REGISTER_SECRET` | `POST /api/tenants/register` |
| `TENANT_BASE_DOMAIN` | Базовый домен поддоменов (`crmavito.online`) |
| `AVITO_*` | OAuth Avito |
| `TELEGRAM_BOT_TOKEN` | Telegram |
| `YANDEX_API_KEY`, `YANDEX_FOLDER_ID` | GPT в `/api/ai/*` |
| `CURSOR_API_KEY` | Cloud Agents (локально, не в git) |
| `STRIPE_*` | Биллинг SaaS |
| `METRICS_TOKEN` | `/api/metrics` |
| `ADVANCE_ALERT_TELEGRAM_*` | Алерты в Telegram |

---

## 8. Команды администратора

```bash
# Локальная разработка
npm run dev
npm run db:push
npm run setup:prod

# Аудит и починка перед сдачей
npm run fix:demo          # превью, unread, клиенты Avito
npm run audit:prod        # строгий чеклист (exit 0 = OK)
npm run audit:full        # расширенный аудит
npm run repair:previews   # рассинхрон превью диалогов

# Деплой
npm run deploy:vps
npm run vps:run -- "cd /opt/crm && npm run fix:demo && npm run audit:prod"

# Упаковка для клиента (без crm.db и .env)
npm run pack:client

# PostgreSQL
npm run migrate:postgres
npm run verify:postgres
npm run pg:ensure-modules

# E2E
npm run test:e2e
npm run test:e2e:sto
npm run test:e2e:billing

# Health на сервере
curl -s https://crmavito.online/api/health | jq .
```

---

## 9. SaaS: организации (tenants)

- Каждая компания = `tenants` + свой `subdomain`.
- Регистрация: `POST /api/tenants/register` + заголовок `X-Register-Key`.
- Поддомен: `https://motor.crmavito.online` → tenant по subdomain.
- Trial 14 дней, статусы: `active`, `trial`, `expired`, `suspended`.
- Биллинг: `/admin/billing`, Stripe webhook.
- Adoption: `GET /api/tenants/adoption?days=7`.

Документация: [SAAS-MODEL.md](./SAAS-MODEL.md), [BILLING_GUIDE.md](./BILLING_GUIDE.md).

---

## 10. Интеграции

| Канал | Настройка | API/сервис |
|-------|-----------|------------|
| Avito | Настройки → Каналы | `api/routes/avito.ts`, webhooks |
| Telegram | Bot token | `api/services/telegram-poll.ts` |
| WhatsApp | Каналы | webhooks |
| СДЭК | Настройки | `api/routes/cdek.ts` |
| ZZap | `/zzap` | `api/services/zzap-upload.ts` |
| Телефония | Настройки | `api/routes/telephony.ts` |
| 1С | Интеграции | `api/integrations/onec.ts` |
| Stripe | env | `api/lib/stripe-integration.ts` |

Avito webhooks: `npx tsx scripts/setup-avito-webhooks.ts`.

---

## 11. AI в CRM

| Что | Где |
|-----|-----|
| Сканеры | `api/lib/ai-scanners.ts` |
| API | `POST /api/ai/scan`, proposals |
| UI | `/assistant` |
| Cloud Agents | `.cursor/rules/crm-cloud-analyst.mdc`, [AGENTS.md](../AGENTS.md) |

---

## 12. Безопасность (чеклист admin)

- [ ] Сильные пароли (мин. 10 символов, буква + цифра)
- [ ] HTTPS + `PUBLIC_URL` с https
- [ ] `AUTH_SALT` уникален на каждой инсталляции
- [ ] Секреты Avito/Telegram только в `.env`, не в git
- [ ] Деактивировать уволенных (`users.is_active = false`)
- [ ] Не копировать `crm.db` между клиентами
- [ ] Бэкапы: [ops/BACKUP-S3.md](./ops/BACKUP-S3.md)
- [ ] RLS PostgreSQL: [ops/POSTGRES-RLS.md](./ops/POSTGRES-RLS.md)

---

## 13. Чеклист перед сдачей клиенту

Полный список: [ops/PRE-HANDOVER.md](./ops/PRE-HANDOVER.md).

Кратко:

1. `npm run fix:demo && npm run audit:prod` → exit 0
2. `/api/health` → `"status":"ok"`, `"previewDesync":0`
3. Smoke: вход, inbox, Avito туда-обратно, каналы зелёные
4. Новый клиент: `pack:client` → свой `.env` → `setup:prod` → Avito webhooks

---

## 14. Структура репозитория

```
api/           — Hono API, middleware, lib, routes, services
src/           — React UI (pages, components, lib)
scripts/       — setup, audit, deploy, migrate
docs/          — документация (этот файл — главный для admin)
e2e/           — Playwright тесты
.cursor/rules/ — правила для AI (crm-cloud-analyst, fix-ide-errors)
server.ts      — dev-сервер
server.prod.ts — production
crm.db         — SQLite (не в git для клиентов)
uploads/       — медиа из чатов
```

---

## 15. Связанная документация

| Тема | Файл |
|------|------|
| Пользователи | [knowledge-base/AVITOPLAN-USER-GUIDE.md](./knowledge-base/AVITOPLAN-USER-GUIDE.md) |
| Инфраструктура | [ops/INFRASTRUCTURE.md](./ops/INFRASTRUCTURE.md) |
| Мониторинг | [ops/MONITORING.md](./ops/MONITORING.md) |
| CI/CD | [ops/CICD.md](./ops/CICD.md) |
| Cloud Agents | [agents/CLOUD-AGENTS-SETUP.md](./agents/CLOUD-AGENTS-SETUP.md) |
| Первый запуск | [../scripts/templates/START-HERE.md](../scripts/templates/START-HERE.md) |

---

*Обновляйте этот файл при добавлении модулей, API или таблиц.*
