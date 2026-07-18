# Миграция SQLite → PostgreSQL

## Когда нужна

- 10+ активных тенантов
- блокировки SQLite (`database is locked`)
- подготовка к SaaS-масштабированию

## Предварительно

1. Свежий бэкап `crm.db`
2. PostgreSQL 15+ (managed или VPS)
3. Окно обслуживания 30–60 мин

## Шаги

### 1. Создать базу

```bash
createdb crm
# или в Yandex Cloud / Selectel — получить DATABASE_URL
```

### 2. Миграция данных

```bash
export CRM_DB_PATH=/opt/crm/data/crm.db
export DATABASE_URL=postgresql://crm:password@127.0.0.1:5432/crm

# Пробный прогон
npx tsx scripts/migrate-sqlite-to-postgres.ts --dry-run

# Миграция
npx tsx scripts/migrate-sqlite-to-postgres.ts

# Проверка
npm run verify:postgres
```

### 3. RLS (изоляция тенантов)

```bash
psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql
npm run pg:ensure-modules
npm run verify:pg-modules
```

### 4. Переключение приложения

Dual-driver включён: при `DATABASE_URL` приложение использует PostgreSQL через `raw-sql` и Drizzle/pg.

```bash
# .env
DATABASE_URL=postgresql://crm:password@127.0.0.1:5432/crm
# CRM_DB_PATH можно оставить для отката

pm2 restart crm
```

Проверка:

```bash
npm run audit:full
npm run verify:postgres   # если DATABASE_URL задан
```

Откат: убрать `DATABASE_URL`, перезапустить PM2 — вернётся SQLite.

### 5. Откат

SQLite-файл не удалять 7+ дней. При откате — убрать `DATABASE_URL`, перезапустить PM2.

## Проверки после миграции

```bash
npm run verify:postgres
npm run audit:prod
```

Сравнить вручную:

- число клиентов / диалогов
- открытые заказы
- остатки склада
