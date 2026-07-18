# SQLite To PostgreSQL + RLS Migration Plan

## Goal

Move CRM AvtoPlan from single-file SQLite storage to PostgreSQL without data loss and with tenant isolation enforced both in code and in the database.

## Migration strategy

Use a phased migration, not a big-bang cutover:

1. Freeze the schema in SQLite.
2. Create the PostgreSQL schema with the same business entities plus strict `tenant_id`.
3. Bulk copy historical data tenant by tenant.
4. Verify row counts and business totals.
5. Enable RLS.
6. Switch the app to PostgreSQL behind a maintenance window.
7. Keep the SQLite snapshot as rollback input.

## Pre-migration checklist

1. All tenant-scoped tables must have `tenant_id`.
2. Every API route must use tenant-aware filters.
3. Every webhook must resolve tenant context before touching data.
4. Every background worker must run inside tenant context.
5. Backups must already be green for at least 7 days.
6. A staging PostgreSQL environment must exist.

## Target PostgreSQL setup

- Managed PostgreSQL in Russia or a VPS-hosted PostgreSQL if required.
- Application role without `BYPASSRLS`.
- Separate admin role for migrations only.
- Connection pool with per-request `SET app.tenant_id`.

## Recommended order

### Phase 1. Prepare PostgreSQL schema

1. Generate PostgreSQL-compatible Drizzle schema.
2. Create all tables with explicit indexes on:
   - `tenant_id`
   - `tenant_id, created_at`
   - `tenant_id, status` where lists depend on status
3. Add unique constraints scoped by tenant where needed:
   - `users(tenant_id, email)`
   - `channels(tenant_id, slug)`
   - `sto_labor_catalog(tenant_id, code)`
4. Add foreign keys that preserve tenant-aware integrity.

### Phase 2. Data export from SQLite

1. Stop writes during final export window.
2. Export each table to JSON or CSV in deterministic order.
3. Preserve original primary keys where possible.
4. Export lookup tables first, then transactional tables:
   - tenants
   - users
   - clients
   - channels
   - conversations
   - messages
   - deals
   - order items
   - labor items
   - service appointments
   - stock and receipts
   - payroll
   - analytics helper tables

### Phase 3. Load into PostgreSQL

1. Load base entities first.
2. Load child rows after parents.
3. Reset sequences to `MAX(id) + 1`.
4. Run post-load fixes for nullable legacy fields.

### Phase 4. Verification

For every migrated table compare:

- total row count
- row count per tenant
- row count per key status
- sample records by id

Business checks:

- total active clients per tenant
- total open conversations per tenant
- total open deals per tenant
- stock totals for key SKUs
- payroll calculation totals for a selected month

### Phase 5. Enable RLS

For every tenant table:

1. `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
2. `ALTER TABLE ... FORCE ROW LEVEL SECURITY`
3. Add `USING` and `WITH CHECK` policy on `tenant_id = current_setting('app.tenant_id')::int`

Keep migrations and admin scripts on a privileged role. The app role must not bypass RLS.

## Application changes required at cutover

1. Replace SQLite client with PostgreSQL driver and Drizzle adapter.
2. On every request:
   - resolve tenant
   - open DB session or transaction
   - run `SET app.tenant_id = '<tenantId>'`
3. Do the same inside:
   - webhook handlers
   - background jobs
   - cron tasks
   - queue workers

## Cutover plan

1. Announce maintenance window.
2. Stop inbound webhooks.
3. Stop background workers.
4. Put the app in read-only or maintenance mode.
5. Take final SQLite backup.
6. Export delta data if needed.
7. Load final delta into PostgreSQL.
8. Run verification script.
9. Switch environment variables to PostgreSQL.
10. Run smoke tests:
    - login
    - tenant subdomain resolution
    - create client
    - create deal
    - open conversation
    - send test message
11. Re-enable webhooks and workers.

## Rollback plan

Rollback is allowed only until write traffic is confirmed on PostgreSQL.

1. Stop the app.
2. Restore SQLite snapshot.
3. Switch env vars back to SQLite.
4. Restart app.
5. Re-run smoke checks.

If PostgreSQL already accepted production writes, do not blindly roll back. Export PostgreSQL delta first.

## Zero-loss rule

The migration is considered successful only if:

- final SQLite backup exists,
- PostgreSQL verification passes,
- tenant row counts match,
- smoke tests pass,
- first post-cutover backup succeeds.
