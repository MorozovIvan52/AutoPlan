/**
 * Проверка критичных таблиц/колонок/индексов tenant_id при старте.
 * Missing index → CREATE; missing table/column → fatal.
 */
import { sqlAll, sqlExec, sqlGet, usePostgres } from "../database/raw-sql";
import { log } from "./logger";

const REQUIRED_TABLES = [
  "tenants",
  "users",
  "clients",
  "deals",
  "conversations",
  "parts_stock",
  "sales_documents",
  "tenant_subscriptions",
  "stripe_webhook_events",
  "broadcasts",
  "notifications",
] as const;

const REQUIRED_TENANT_COLUMNS: { table: string; column: string }[] = [
  { table: "clients", column: "tenant_id" },
  { table: "deals", column: "tenant_id" },
  { table: "conversations", column: "tenant_id" },
  { table: "parts_stock", column: "tenant_id" },
  { table: "sales_documents", column: "tenant_id" },
  { table: "users", column: "tenant_id" },
  { table: "broadcasts", column: "tenant_id" },
  { table: "notifications", column: "tenant_id" },
  { table: "zzap_settings", column: "tenant_id" },
  { table: "zzap_price_lists", column: "tenant_id" },
];

/** Индексы для быстрых forTenant-запросов — создаём автоматически. */
const TENANT_INDEXES: { name: string; sql: string }[] = [
  { name: "idx_clients_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_clients_tenant ON clients(tenant_id)" },
  { name: "idx_deals_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_deals_tenant ON deals(tenant_id)" },
  { name: "idx_conversations_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_conversations_tenant ON conversations(tenant_id)" },
  { name: "idx_parts_stock_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_parts_stock_tenant ON parts_stock(tenant_id)" },
  { name: "idx_sales_documents_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_sales_documents_tenant ON sales_documents(tenant_id)" },
  { name: "idx_users_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)" },
  { name: "idx_broadcasts_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant ON broadcasts(tenant_id)" },
  { name: "idx_notifications_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id)" },
  { name: "idx_call_logs_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_call_logs_tenant ON call_logs(tenant_id)" },
];

async function tableExists(name: string): Promise<boolean> {
  if (usePostgres()) {
    const row = await sqlGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`,
      name,
    );
    return (row?.n ?? 0) > 0;
  }
  const row = await sqlGet<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return Boolean(row?.name);
}

async function columnExists(table: string, column: string): Promise<boolean> {
  if (usePostgres()) {
    const row = await sqlGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      table,
      column,
    );
    return (row?.n ?? 0) > 0;
  }
  const cols = await sqlAll<{ name: string }>(`PRAGMA table_info(${table})`);
  return cols.some((c) => c.name === column);
}

export type SchemaCheckResult = {
  ok: boolean;
  missingTables: string[];
  missingTenantColumns: string[];
  indexesEnsured: string[];
};

export async function assertCriticalSchema(opts?: { fatal?: boolean }): Promise<SchemaCheckResult> {
  const fatal = opts?.fatal ?? true;
  const missingTables: string[] = [];
  const missingTenantColumns: string[] = [];
  const indexesEnsured: string[] = [];

  for (const t of REQUIRED_TABLES) {
    if (!(await tableExists(t))) missingTables.push(t);
  }

  for (const { table, column } of REQUIRED_TENANT_COLUMNS) {
    if (!(await tableExists(table))) continue;
    if (!(await columnExists(table, column))) {
      missingTenantColumns.push(`${table}.${column}`);
    }
  }

  for (const idx of TENANT_INDEXES) {
    const table = idx.sql.match(/ON (\w+)/)?.[1];
    if (table && !(await tableExists(table))) continue;
    try {
      await sqlExec(idx.sql);
      indexesEnsured.push(idx.name);
    } catch (e) {
      log.warn({ index: idx.name, err: e instanceof Error ? e.message : String(e) }, "tenant index ensure failed");
    }
  }

  const ok = missingTables.length === 0 && missingTenantColumns.length === 0;
  if (!ok) {
    log.error(
      { missingTables, missingTenantColumns },
      "schema check failed — critical tables/columns missing",
    );
    if (fatal) {
      throw new Error(
        `Schema check failed. Missing tables: [${missingTables.join(", ")}]. ` +
        `Missing tenant columns: [${missingTenantColumns.join(", ")}]`,
      );
    }
  } else {
    log.info({ tables: REQUIRED_TABLES.length, indexesEnsured: indexesEnsured.length }, "schema check ok");
  }

  return { ok, missingTables, missingTenantColumns, indexesEnsured };
}
