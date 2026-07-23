/**
 * Verify Postgres modules expected after migration + pg:ensure-modules.
 *
 * Usage: npm run verify:pg-modules
 * Requires DATABASE_URL. Read-only. Does not deploy.
 */
import "../load-env.ts";
import { closeDatabase, usePostgres } from "../api/database/index.ts";
import { tableColumns, tableExists } from "../api/database/raw-sql.ts";

const REQUIRED_TABLES = [
  "tenants",
  "users",
  "clients",
  "deals",
  "conversations",
  "messages",
  "parts_stock",
  "supplier_orders",
  "stock_inventory_sessions",
  "stock_inventory_lines",
  "parts_categories",
  "deal_work_sessions",
  "stripe_webhook_events",
  "subscription_plans",
  "tenant_subscriptions",
  "invoices",
  "tenant_usage",
  "audit_logs",
  "support_tickets",
  "api_keys",
  "sto_labor_catalog",
] as const;

const REQUIRED_COLUMNS: { table: string; column: string }[] = [
  { table: "clients", column: "tenant_id" },
  { table: "deals", column: "tenant_id" },
  { table: "conversations", column: "tenant_id" },
  { table: "parts_stock", column: "tenant_id" },
  { table: "parts_stock", column: "reserved_qty" },
  { table: "supplier_orders", column: "tenant_id" },
  { table: "tenant_usage", column: "vin_decodes_used" },
];

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required");
  }
  if (!usePostgres()) {
    throw new Error("Not in Postgres mode (CRM_FORCE_SQLITE?)");
  }

  process.env.PG_RLS = process.env.PG_RLS ?? "0";

  let failed = 0;
  console.log("[verify:pg-modules] checking required tables/columns…");

  for (const table of REQUIRED_TABLES) {
    const ok = await tableExists(table);
    console.log(`[${ok ? "OK" : "FAIL"}] table ${table}`);
    if (!ok) failed++;
  }

  for (const { table, column } of REQUIRED_COLUMNS) {
    if (!(await tableExists(table))) {
      console.log(`[FAIL] column ${table}.${column} (table missing)`);
      failed++;
      continue;
    }
    const cols = await tableColumns(table);
    const ok = cols.some((c) => c.name === column);
    console.log(`[${ok ? "OK" : "FAIL"}] column ${table}.${column}`);
    if (!ok) failed++;
  }

  // RLS policies are optional here — applied by setup-postgres-rls.pgsql separately.
  console.log(
    `\n[verify:pg-modules] ${failed === 0 ? "PASS" : "FAIL"} (${failed} problem(s))`,
  );
  console.log(
    "[verify:pg-modules] Reminder: apply RLS with scripts/setup-postgres-rls.pgsql before production cutover.",
  );
  if (failed > 0) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error("[verify:pg-modules] FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
