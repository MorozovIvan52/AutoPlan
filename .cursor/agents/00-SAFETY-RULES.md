# Правила безопасности (вставлять в начало КАЖДОГО агента)

## Запрещено без явного «ДА» от владельца

1. **SQL напрямую** — не выполнять `DELETE`, `DROP`, `TRUNCATE`, массовый `UPDATE` в production/SQLite на VPS.
2. **`.env`** — не менять `DATABASE_URL`, секреты, `PUBLIC_URL`, пароли.
3. **Production tenant** — не трогать данные клиентов вне demo-tenant `sto-1`, `sto-2`, `sto-3`.
4. **Git** — не делать `push`, `force push`, `commit --amend` без запроса.
5. **Миграции** — не править файлы в `drizzle/` и `scripts/setup-postgres-rls.pgsql` без отдельного согласования.

## Обязательно перед изменениями кода

1. Показать **план** (3–5 пунктов) и **почему** так, а не иначе.
2. Показать **diff** или перечень файлов — ждать «ок» / «делай».
3. Минимальный diff — только то, что решает задачу.
4. После правок — команда проверки (`npm run pilot:verify`, `npx tsc --noEmit`, e2e).

## Demo-полигон (единственная «песочница» для автоматических действий)

| Tenant | Slug | Логин (пример) | Пароль |
|--------|------|----------------|--------|
| СТО 1 | `sto-1` | master@sto1.demo | PilotDemo2026! |
| СТО 2 | `sto-2` | master@sto2.demo | то же |
| СТО 3 | `sto-3` | master@sto3.demo | то же |

Манифест ID: `scripts/pilot-demo-manifest.json`  
Seed: `npm run pilot:seed:clean` (только sto-1/2/3)

## Стек проекта

Node 20+, Hono (`api/`), React 19 (`src/`), Drizzle, SQLite (VPS сейчас) → Postgres + RLS (план).
