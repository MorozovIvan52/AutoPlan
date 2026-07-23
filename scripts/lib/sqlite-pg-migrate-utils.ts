/**
 * Shared helpers for SQLite → Postgres migration scripts.
 * Opens SQLite and Postgres separately (dual-driver in api/database opens only one).
 */
import Database from "better-sqlite3";
import pg from "pg";

export type SqliteColumn = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

/** Parents before children — FK-safe when constraints exist. Remaining tables appended later. */
export const PREFERRED_COPY_ORDER: string[] = [
  "tenants",
  "subscription_plans",
  "users",
  "sessions",
  "license_offer_otps",
  "user_login_sessions",
  "user_activity_events",
  "tenant_integrations",
  "tenant_subscriptions",
  "invoices",
  "tenant_usage",
  "tags",
  "clients",
  "vehicles",
  "client_tags",
  "client_comments",
  "channels",
  "conversations",
  "messages",
  "service_appointments",
  "deals",
  "order_items",
  "deal_labor_items",
  "deal_diagnostic_items",
  "deal_notes",
  "deal_audit_log",
  "deal_work_sessions",
  "parts_categories",
  "parts_stock",
  "stock_receipts",
  "stock_receipt_items",
  "stock_movements",
  "stock_inventory_sessions",
  "stock_inventory_lines",
  "supplier_orders",
  "sto_enterprises",
  "sto_labor_catalog",
  "sto_labor_complexes",
  "sto_labor_complex_items",
  "client_advances",
  "advance_allocations",
  "sales_documents",
  "sales_document_items",
  "documents",
  "quick_templates",
  "service_schedule",
  "service_settings",
  "crm_settings",
  "cdek_settings",
  "zzap_settings",
  "zzap_price_lists",
  "telephony_settings",
  "broadcasts",
  "call_logs",
  "parts_buyouts",
  "report_daily_overrides",
  "activity_log",
  "audit_logs",
  "api_keys",
  "stripe_webhook_events",
  "notifications",
  "tasks",
  "task_comments",
  "team_chat_groups",
  "team_chat_members",
  "team_chat_messages",
  "payroll_roles",
  "payroll_rules",
  "payroll_calculations",
  "payroll_calculation_lines",
  "ai_proposals",
  "support_tickets",
  "ticket_replies",
  "tenant_webhooks",
  "webhook_logs",
];

export const BUSINESS_VERIFY_TABLES = [
  "tenants",
  "users",
  "clients",
  "vehicles",
  "conversations",
  "messages",
  "deals",
  "parts_stock",
  "order_items",
  "sales_documents",
  "sto_labor_catalog",
  "activity_log",
] as const;

export function parseArgs(argv: string[]) {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  return {
    dryRun: flags.has("--dry-run"),
    force: flags.has("--force"),
    help: flags.has("--help") || flags.has("-h"),
  };
}

export function normalizeDatabaseUrl(raw: string): string {
  return raw.trim().replace(/^postgresql\+asyncpg:/, "postgresql:");
}

export function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`Unsafe SQL identifier: ${name}`);
  }
  return `"${name}"`;
}

/** Map SQLite affinity → Postgres. Keep INTEGER as BIGINT (ms timestamps + 0/1 flags). */
export function mapSqliteTypeToPg(sqliteType: string, isTextPk: boolean): string {
  if (isTextPk) return "TEXT";
  const t = (sqliteType || "TEXT").toUpperCase();
  if (t.includes("BLOB")) return "BYTEA";
  if (t.includes("INT")) return "BIGINT";
  if (t.includes("REAL") || t.includes("FLOA") || t.includes("DOUB")) return "DOUBLE PRECISION";
  if (t.includes("NUMERIC") || t.includes("DECIMAL")) return "DOUBLE PRECISION";
  return "TEXT";
}

export function openSqliteReadonly(dbPath: string): Database.Database {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("query_only = ON");
  return db;
}

export function openPgPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({
    connectionString: normalizeDatabaseUrl(databaseUrl),
    max: Number(process.env.PG_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
  });
}

export function listSqliteTables(sqlite: Database.Database): string[] {
  const rows = sqlite
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'
       ORDER BY name`,
    )
    .all() as { name: string }[];
  return rows.map((r) => r.name);
}

export function tableColumns(sqlite: Database.Database, table: string): SqliteColumn[] {
  return sqlite.prepare(`PRAGMA table_info(${quoteIdent(table)})`).all() as SqliteColumn[];
}

export function orderedTables(all: string[]): string[] {
  const set = new Set(all);
  const ordered: string[] = [];
  for (const name of PREFERRED_COPY_ORDER) {
    if (set.has(name)) {
      ordered.push(name);
      set.delete(name);
    }
  }
  for (const name of [...set].sort()) ordered.push(name);
  return ordered;
}

export function buildCreateTableSql(table: string, cols: SqliteColumn[]): string {
  const parts: string[] = [];
  const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk);
  const compositePk = pkCols.length > 1;

  for (const col of cols) {
    const isSoleIntPk = !compositePk && col.pk === 1;
    const isTextPk =
      isSoleIntPk &&
      /TEXT|CHAR|CLOB/i.test(col.type || "") &&
      !/INT/i.test(col.type || "");
    // INTEGER PRIMARY KEY in SQLite is rowid; map to BIGINT PK (sequence attached later).
    // TEXT PK (sessions, stripe_webhook_events) stays TEXT.
    let pgType = mapSqliteTypeToPg(col.type, isTextPk);
    if (isSoleIntPk && !isTextPk) pgType = "BIGINT";

    let line = `${quoteIdent(col.name)} ${pgType}`;
    if (isSoleIntPk && !compositePk) {
      line += " PRIMARY KEY";
    }
    // Intentionally skip NOT NULL for non-PK columns: live SQLite sometimes
    // has nulls even when pragma notnull=1; strict PG would abort mid-copy.
    parts.push(line);
  }

  if (compositePk) {
    parts.push(`PRIMARY KEY (${pkCols.map((c) => quoteIdent(c.name)).join(", ")})`);
  }

  return `CREATE TABLE IF NOT EXISTS ${quoteIdent(table)} (\n  ${parts.join(",\n  ")}\n)`;
}

export function sqliteRowCount(sqlite: Database.Database, table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${quoteIdent(table)}`).get() as {
    c: number;
  };
  return Number(row.c);
}

export async function pgRowCount(client: pg.Pool | pg.PoolClient, table: string): Promise<number> {
  const res = await client.query(`SELECT COUNT(*)::bigint AS c FROM ${quoteIdent(table)}`);
  return Number(res.rows[0]?.c ?? 0);
}

export async function pgTableExists(client: pg.Pool | pg.PoolClient, table: string): Promise<boolean> {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return res.rowCount !== null && res.rowCount > 0;
}

export function convertCell(value: unknown): unknown {
  if (value === undefined) return null;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return value;
  // better-sqlite3 may return BigInt for large integers
  if (typeof value === "bigint") {
    if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
      return value.toString();
    }
    return Number(value);
  }
  return value;
}

export async function ensureIdSequence(
  client: pg.PoolClient,
  table: string,
  cols: SqliteColumn[],
): Promise<void> {
  const pk = cols.filter((c) => c.pk > 0);
  if (pk.length !== 1) return;
  const pkCol = pk[0]!;
  if (/TEXT|CHAR|CLOB/i.test(pkCol.type || "") && !/INT/i.test(pkCol.type || "")) return;

  const seqName = `${table}_${pkCol.name}_seq`;
  const qTable = quoteIdent(table);
  const qCol = quoteIdent(pkCol.name);
  const qSeq = quoteIdent(seqName);

  await client.query(`CREATE SEQUENCE IF NOT EXISTS ${qSeq}`);
  await client.query(
    `ALTER TABLE ${qTable} ALTER COLUMN ${qCol} SET DEFAULT nextval('${seqName}')`,
  );
  await client.query(`ALTER SEQUENCE ${qSeq} OWNED BY ${qTable}.${qCol}`);
  await client.query(
    `SELECT setval(
       '${seqName}',
       GREATEST(COALESCE((SELECT MAX(${qCol}) FROM ${qTable}), 1), 1),
       true
     )`,
  );
}

export const BATCH_SIZE = 200;
