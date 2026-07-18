# PostgreSQL Row-Level Security (справка)

> **Канонический скрипт:** [`scripts/setup-postgres-rls.pgsql`](../../scripts/setup-postgres-rls.pgsql)  
> Запуск: `psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql`

Применять после миграции с SQLite на PostgreSQL.

В приложении перед запросами (опционально):

```sql
SET app.tenant_id = '<tenantId>';
```

## Пример политики для `clients`

```sql
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_clients ON clients
  USING (tenant_id = current_setting('app.tenant_id')::int)
  WITH CHECK (tenant_id = current_setting('app.tenant_id')::int);
```

## Таблицы с `tenant_id`

`users`, `tags`, `clients`, `channels`, `conversations`, `deals`, `parts_stock`,
`quick_templates`, `notifications`, `tasks`, `service_schedule`, `service_appointments`,
`service_settings`, `broadcasts`, `call_logs`, `cdek_settings`, `sto_enterprises`,
`crm_settings`, `sales_documents`, `zzap_settings`, `zzap_price_lists`,
`telephony_settings`, `team_chat_groups`, `ai_proposals`, `parts_buyouts`,
`activity_log`, `payroll_roles`, `payroll_rules`, `payroll_calculations`,
`report_daily_overrides`, `sto_labor_catalog`, `sto_labor_complexes`,
`stock_receipts`, `client_advances`

## Роль приложения

```sql
CREATE ROLE crm_app LOGIN PASSWORD '...';
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_app;
```

## Node.js (pg pool)

```typescript
await client.query(`SET app.tenant_id = $1`, [tenantId]);
```
