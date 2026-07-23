-- Демо-полигон CRM «АвтоПлан» — PostgreSQL (справочный / verify-only)
-- ВАЖНО: пароли scrypt — создавайте данные через npm run pilot:seed (Drizzle).
-- Этот файл: проверка после seed + напоминание про RLS.

\set ON_ERROR_STOP on

-- 1) Проверка тенантов
SELECT id, slug, name, subdomain, subscription_status
FROM tenants
WHERE slug IN ('sto-1', 'sto-2', 'sto-3')
ORDER BY id;

-- 2) Пользователи (9 шт.)
SELECT t.slug, u.email, u.role, u.name
FROM users u
JOIN tenants t ON t.id = u.tenant_id
WHERE t.slug IN ('sto-1', 'sto-2', 'sto-3')
ORDER BY t.slug, u.email;

-- 3) Склад (5 позиций × 3 СТО, PILOT-*-RACE qty=1)
SELECT t.slug, p.article, p.qty, p.name
FROM parts_stock p
JOIN tenants t ON t.id = p.tenant_id
WHERE t.slug IN ('sto-1', 'sto-2', 'sto-3')
ORDER BY t.slug, p.article;

-- 4) ЗН (2 на tenant: done + in_progress)
SELECT t.slug, d.id, d.status, d.payment_status, d.title
FROM deals d
JOIN tenants t ON t.id = d.tenant_id
WHERE t.slug IN ('sto-1', 'sto-2', 'sto-3') AND d.order_type = 'service'
ORDER BY t.slug, d.id;

-- 5) Товарные чеки
SELECT t.slug, s.id, s.doc_number, s.status, s.deal_id, s.total_amount
FROM sales_documents s
JOIN tenants t ON t.id = s.tenant_id
WHERE t.slug IN ('sto-1', 'sto-2', 'sto-3') AND s.doc_type = 'receipt'
ORDER BY t.slug, s.id;

-- 6) RLS (обязательно для 3 СТО в одной БД)
-- psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql
-- export PG_RLS=1

-- 7) Очистка (только после пилота — удаляет ВСЕ данные 3 demo-tenant)
-- npm run pilot:seed:clean
