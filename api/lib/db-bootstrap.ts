import {
  sqlGet,
  sqlRun,
  sqlExec,
  tableColumns,
  usePostgres,
} from "../database/raw-sql";
import { ensureCrmSettingsTable } from "./crm-settings";
import { ensureSalesTables } from "./sales-db";
import { ensureDealLaborTables } from "./deal-totals";
import { ensureStoExtendedTables } from "./sto-extended-bootstrap";
import { ensureEnterpriseTables } from "./enterprises";
import { ensureDemoColumns } from "./demo-bootstrap";
import { ensureCompetitorColumns } from "./competitor-bootstrap";
import { ensureWarehouseModules } from "./warehouse-bootstrap";
import { ensureDemoAccountAndData } from "./demo-seed";
import { ensureTableTenantColumn, ensureTenantTables } from "./tenant-bootstrap";
import { ensureAllSaasBootstrap } from "./saas-bootstrap";
import { alertBillingIssue } from "./sentry";
import { ensureStripeWebhookEventsTable } from "./stripe-webhook-events";
import { assertCriticalSchema } from "./schema-assert";
import { ensureSupportAgentSchema } from "./support-bootstrap";
import { ensureDocumentsSchema } from "./documents-bootstrap";
import { ensureSaasCompositeUniques } from "./saas-unique-bootstrap";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensurePerformanceIndexes() {
  if (usePostgres()) return;
  const indexes = [
    "CREATE INDEX IF NOT EXISTS idx_conv_last_message_at ON conversations(last_message_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_conv_channel_type ON conversations(channel_type)",
    "CREATE INDEX IF NOT EXISTS idx_conv_assigned ON conversations(assigned_to)",
    "CREATE INDEX IF NOT EXISTS idx_conv_status ON conversations(status)",
    "CREATE INDEX IF NOT EXISTS idx_conv_client_id ON conversations(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_conv_external ON conversations(channel_type, external_chat_id)",
    "CREATE INDEX IF NOT EXISTS idx_messages_conv_created ON messages(conversation_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_messages_external ON messages(external_message_id)",
    "CREATE INDEX IF NOT EXISTS idx_clients_external ON clients(external_id, source)",
    "CREATE INDEX IF NOT EXISTS idx_client_tags_client ON client_tags(client_id)",
    "CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_sales_docs_manager ON sales_documents(manager_id, posted_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_deals_assigned ON deals(assigned_to, updated_at DESC)",
  ];
  for (const sql of indexes) {
    try { await sqlExec(sql); } catch { /* exists */ }
  }
}

export async function ensureActivityTrackingTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS user_login_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_id TEXT,
      ip TEXT,
      user_agent TEXT,
      login_at INTEGER NOT NULL,
      logout_at INTEGER,
      last_activity_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_user_login_sessions_user ON user_login_sessions(user_id, login_at DESC);
    CREATE TABLE IF NOT EXISTS user_activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      meta TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_user_activity_events_user ON user_activity_events(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_activity_events_type ON user_activity_events(event_type, created_at DESC);
  `);
  if (!(await hasColumn("users", "payroll_role_id"))) {
    await sqlExec("ALTER TABLE users ADD COLUMN payroll_role_id INTEGER REFERENCES payroll_roles(id)");
  }
  if (!(await hasColumn("conversations", "unread_pinned"))) {
    await sqlExec("ALTER TABLE conversations ADD COLUMN unread_pinned INTEGER DEFAULT 0");
  }
}

export async function ensurePayrollTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS payroll_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS payroll_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_id INTEGER REFERENCES payroll_roles(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      calc_type TEXT NOT NULL DEFAULT 'percent',
      value REAL NOT NULL DEFAULT 0,
      label TEXT,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS payroll_calculations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      role_id INTEGER REFERENCES payroll_roles(id),
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      status TEXT DEFAULT 'draft',
      total_amount REAL DEFAULT 0,
      adjustments TEXT,
      notes TEXT,
      created_by INTEGER REFERENCES users(id),
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS payroll_calculation_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      calculation_id INTEGER NOT NULL REFERENCES payroll_calculations(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      source_id INTEGER,
      source_label TEXT,
      base_amount REAL DEFAULT 0,
      percent REAL,
      fixed_amount REAL,
      amount REAL DEFAULT 0,
      rule_id INTEGER REFERENCES payroll_rules(id)
    );
  `);

  const count = await sqlGet<{ n: number }>("SELECT COUNT(*) AS n FROM payroll_roles");
  if ((count?.n ?? 0) === 0) {
    const roles = [
      ["Менеджер", "manager", 1],
      ["Мастер-приёмщик", "service_advisor", 2],
      ["Механик", "mechanic", 3],
      ["Бухгалтер", "accountant", 4],
      ["Директор", "director", 5],
    ];
    const now = Date.now();
    for (const [name, slug, order] of roles) {
      await sqlRun(
        "INSERT INTO payroll_roles (name, slug, sort_order, is_active, created_at) VALUES (?, ?, ?, 1, ?)",
        name, slug, order, now,
      );
    }
    const defaults = [
      ["manager", "receipt", 3],
      ["manager", "invoice", 2],
      ["manager", "deal_parts", 5],
      ["manager", "buyout", 1],
      ["service_advisor", "deal_service", 3],
      ["service_advisor", "deal_parts", 2],
      ["mechanic", "deal_service", 8],
      ["mechanic", "labor_line", 8],
    ];
    const labels: Record<string, string> = {
      receipt: "Товарный чек",
      invoice: "Расходная накладная",
      deal_parts: "Заказ запчастей",
      deal_service: "Заказ-наряд СТО",
      labor_line: "Работа в ЗН",
      buyout: "Выкуп запчастей",
    };
    for (const [slug, src, pct] of defaults) {
      await sqlRun(`
        INSERT INTO payroll_rules (role_id, source_type, calc_type, value, label, is_active, sort_order, created_at)
        SELECT id, ?, 'percent', ?, ?, 1, 0, ? FROM payroll_roles WHERE slug = ?
      `, src, pct, labels[src] || src, Date.now(), slug);
    }
    await sqlRun(`
      INSERT INTO payroll_rules (role_id, source_type, calc_type, value, label, is_active, sort_order, created_at)
      SELECT id, 'daily_shift', 'fixed', 2000, 'Выход (смена)', 1, -1, ? FROM payroll_roles WHERE slug = 'manager'
    `, Date.now());
  } else {
    await ensureManagerPayrollDefaults();
  }
}

/** Добавляет выход 2000 и 2.5% менеджеру, если ещё нет */
export async function ensureManagerPayrollDefaults() {
  if (usePostgres()) return;
  const manager = await sqlGet<{ id: number }>("SELECT id FROM payroll_roles WHERE slug = 'manager'");
  if (!manager) return;

  const hasShift = await sqlGet(
    "SELECT 1 FROM payroll_rules WHERE role_id = ? AND source_type = 'daily_shift' LIMIT 1",
    manager.id,
  );
  if (!hasShift) {
    await sqlRun(`
      INSERT INTO payroll_rules (role_id, source_type, calc_type, value, label, is_active, sort_order, created_at)
      VALUES (?, 'daily_shift', 'fixed', 2000, 'Выход (смена)', 1, -1, ?)
    `, manager.id, Date.now());
  }

  const managerPercents: [string, number][] = [
    ["receipt", 2.5],
    ["invoice", 2.5],
    ["deal_parts", 2.5],
    ["deal_service", 2.5],
    ["buyout", 2.5],
  ];
  for (const [src, pct] of managerPercents) {
    const exists = await sqlGet<{ value: number }>(
      "SELECT value FROM payroll_rules WHERE role_id = ? AND source_type = ? AND user_id IS NULL LIMIT 1",
      manager.id, src,
    );
    if (!exists) {
      const labels: Record<string, string> = {
        receipt: "Товарный чек",
        invoice: "Расходная накладная",
        deal_parts: "Заказ запчастей",
        deal_service: "Заказ-наряд СТО",
        buyout: "Выкуп запчастей",
      };
      await sqlRun(`
        INSERT INTO payroll_rules (role_id, source_type, calc_type, value, label, is_active, sort_order, created_at)
        VALUES (?, ?, 'percent', ?, ?, 1, 0, ?)
      `, manager.id, src, pct, labels[src], Date.now());
    }
  }
}

export async function ensureUnreadPinnedColumn(): Promise<void> {
  if (usePostgres()) return;
  const rows = await tableColumns("conversations");
  if (!rows.some((r) => r.name === "unread_pinned")) {
    await sqlExec("ALTER TABLE conversations ADD COLUMN unread_pinned INTEGER DEFAULT 0");
  }
}

export async function ensureAllDbBootstrap() {
  await ensureTenantTables();
  await ensureCrmSettingsTable();
  await ensureSalesTables();
  await ensureTableTenantColumn("sales_documents");
  await ensureDealLaborTables();
  await ensureStoExtendedTables();
  await ensureEnterpriseTables();
  await ensurePerformanceIndexes();
  await ensurePayrollTables();
  await ensureManagerPayrollDefaults();
  await ensureActivityTrackingTables();
  await ensureUnreadPinnedColumn();
  await ensureCompetitorColumns();
  await ensureWarehouseModules();
  await ensureDemoColumns();
  await ensureStripeWebhookEventsTable();
  await ensureSupportAgentSchema();
  await ensureDocumentsSchema();
  await ensureSaasCompositeUniques();
  void ensureDemoAccountAndData().catch((e) => console.warn("[demo] seed skipped:", e?.message || e));
}

/** SaaS-таблицы, тарифы и подписки — await при старте prod */
export async function ensureSaasOnStartup(): Promise<void> {
  try {
    const stats = await ensureAllSaasBootstrap();
    await ensureStripeWebhookEventsTable();
    await assertCriticalSchema({ fatal: true });
    console.log(`[saas] bootstrap OK: ${stats.plans} plans, ${stats.subscriptions} tenant subscriptions`);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[saas] bootstrap FAILED:", msg);
    alertBillingIssue({ event: "bootstrap_failed", details: msg, error: e });
    throw e;
  }
}
