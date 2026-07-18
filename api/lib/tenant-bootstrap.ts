import {
  sqlGet,
  sqlRun,
  sqlExec,
  tableColumns,
  tableExists,
  usePostgres,
} from "../database/raw-sql";

const DEFAULT_TENANT_ID = 1;

const TENANT_SCOPED_TABLES = [
  "users",
  "tags",
  "clients",
  "channels",
  "conversations",
  "deals",
  "parts_stock",
  "quick_templates",
  "notifications",
  "tasks",
  "service_schedule",
  "service_appointments",
  "service_settings",
  "broadcasts",
  "call_logs",
  "cdek_settings",
  "sto_enterprises",
  "crm_settings",
  "sales_documents",
  "zzap_settings",
  "zzap_price_lists",
  "telephony_settings",
  "team_chat_groups",
  "ai_proposals",
  "parts_buyouts",
  "activity_log",
  "payroll_roles",
  "payroll_rules",
  "payroll_calculations",
  "report_daily_overrides",
  "sto_labor_catalog",
  "sto_labor_complexes",
  "stock_receipts",
  "client_advances",
] as const;

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

async function ensureTenantColumns(table: string) {
  if (!(await tableExists(table))) return;
  if (!(await hasColumn(table, "tenant_id"))) {
    await sqlExec(`ALTER TABLE ${table} ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT ${DEFAULT_TENANT_ID}`);
    await sqlExec(`UPDATE ${table} SET tenant_id = ${DEFAULT_TENANT_ID} WHERE tenant_id IS NULL OR tenant_id = 0`);
  }
}

/** Run after tables that may be created later in bootstrap (e.g. sales_documents). */
export async function ensureTableTenantColumn(table: string) {
  if (usePostgres()) return;
  await ensureTenantColumns(table);
}

export async function ensureTenantTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      subdomain TEXT UNIQUE,
      subscription_status TEXT NOT NULL DEFAULT 'active',
      subscription_plan TEXT DEFAULT 'start',
      trial_ends_at INTEGER,
      max_users INTEGER DEFAULT 3,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tenants_subdomain ON tenants(subdomain);
    CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);

    CREATE TABLE IF NOT EXISTS tenant_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      config_json TEXT,
      is_active INTEGER DEFAULT 1,
      updated_at INTEGER,
      UNIQUE(tenant_id, provider)
    );
  `);

  for (const table of TENANT_SCOPED_TABLES) {
    await ensureTenantColumns(table);
  }

  if (await tableExists("users")) {
    if (!(await hasColumn("users", "onboarding_completed"))) {
      await sqlExec("ALTER TABLE users ADD COLUMN onboarding_completed INTEGER DEFAULT 0");
    }
    if (!(await hasColumn("users", "is_champion"))) {
      await sqlExec("ALTER TABLE users ADD COLUMN is_champion INTEGER DEFAULT 0");
    }
  }

  for (const table of TENANT_SCOPED_TABLES) {
    if (!(await tableExists(table))) continue;
    try {
      await sqlExec(`CREATE INDEX IF NOT EXISTS idx_${table}_tenant ON ${table}(tenant_id)`);
    } catch { /* ignore */ }
  }

  const count = await sqlGet<{ n: number }>("SELECT COUNT(*) AS n FROM tenants");
  if ((count?.n ?? 0) === 0) {
    const name = process.env.DEFAULT_TENANT_NAME?.trim() || "АвтоПлан";
    const slug = process.env.DEFAULT_TENANT_SLUG?.trim() || "default";
    const subdomain = process.env.DEFAULT_TENANT_SUBDOMAIN?.trim() || null;
    await sqlRun(`
      INSERT INTO tenants (id, slug, name, subdomain, subscription_status, subscription_plan, max_users, is_active, created_at)
      VALUES (?, ?, ?, ?, 'active', 'business', 25, 1, ?)
    `, DEFAULT_TENANT_ID, slug, name, subdomain, Date.now());
  }
}

export { DEFAULT_TENANT_ID };
