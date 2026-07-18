# Аудит безопасности мультитенантности — CRM АвтоПлан

Дата: июль 2026

## Исправлено (критичные дыры)

| Область | Мера |
|---------|------|
| IDOR по заказам | `deals.ts` — CRUD с `withTenant` |
| IDOR по диалогам | `conversations.ts` — `getConversationInTenant` |
| Клиенты / склад | `clients.ts`, `parts.ts` |
| Пользователи | `users.ts` — только свой tenant |
| Каналы / теги | `channels.ts`, `tags.ts` |
| Аналитика | `analytics.ts` — overview с `forTenant` |
| Поиск в чатах | `chat-search.ts` — SQL с `tenant_id` |
| Messaging | `tenantId` при создании клиента/диалога |
| Телефония | клиенты/настройки по tenant; webhook по секрету |
| Вебхуки Telegram | `runAsChannelTenant` |
| СТО / ЗН | middleware `assertDealInTenant` на `/deals/:dealId/*` |
| Реализация | `sales.ts` — `getSalesDocInTenant` |
| Auth | `user.tenantId` vs request tenant |

## Остаётся (средний приоритет)

- `team-chat`, `payroll`, `zzap`, `cdek`, `ai`, `buyouts`, `broadcasts`, `calls`, `templates`, `vehicles`, `orders` — довести `:id` до `withTenant`
- Фоновые воркеры — цикл по tenant при масштабировании
- PostgreSQL RLS — `docs/ops/POSTGRES-RLS.md`, скрипт `scripts/setup-postgres-rls.pgsql`

## Рекомендации

1. `TENANT_REGISTER_SECRET` в production
2. Уникальный webhook_secret на организацию
3. Wildcard SSL для поддоменов
4. Бэкапы off-site
5. PostgreSQL + RLS перед десятками клиентов
