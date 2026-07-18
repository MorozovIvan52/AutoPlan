import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "./tenant-context";
import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureCrmSettingsTable() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS crm_settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      avito_auto_deals INTEGER DEFAULT 0,
      avito_advance_alert_enabled INTEGER DEFAULT 1,
      avito_advance_threshold_rub INTEGER DEFAULT 200,
      updated_at INTEGER
    );
  `);
  if (!(await hasColumn("crm_settings", "tenant_id"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1");
  }
  if (!(await hasColumn("crm_settings", "avito_advance_alert_enabled"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN avito_advance_alert_enabled INTEGER DEFAULT 1");
  }
  if (!(await hasColumn("crm_settings", "avito_advance_threshold_rub"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN avito_advance_threshold_rub INTEGER DEFAULT 200");
  }
  if (!(await hasColumn("crm_settings", "advance_alert_telegram_chat_id"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN advance_alert_telegram_chat_id TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_name"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_name TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_address"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_address TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_phone"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_phone TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_inn"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_inn TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_kpp"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_kpp TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_bank"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_bank TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_bik"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_bik TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_rs"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_rs TEXT");
  }
  if (!(await hasColumn("crm_settings", "company_ks"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN company_ks TEXT");
  }
  if (!(await hasColumn("crm_settings", "vat_mode"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN vat_mode TEXT DEFAULT 'with_vat_20'");
  }
  if (!(await hasColumn("crm_settings", "sbp_pay_payload"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN sbp_pay_payload TEXT");
  }
  if (!(await hasColumn("crm_settings", "warranty_templates"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN warranty_templates TEXT");
  }
  if (!(await hasColumn("crm_settings", "receipt_show_articles"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN receipt_show_articles INTEGER DEFAULT 1");
  }
}

export async function getCrmSettings() {
  const tenantId = getTenantId();
  const [row] = await db.select().from(schema.crmSettings).where(eq(schema.crmSettings.tenantId, tenantId)).limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.crmSettings).values({ tenantId }).returning();
  return created;
}

export async function patchCrmSettings(patch: Record<string, unknown>) {
  const current = await getCrmSettings();
  const [updated] = await db.update(schema.crmSettings)
    .set({ ...patch, updatedAt: new Date() } as Partial<typeof schema.crmSettings.$inferInsert>)
    .where(eq(schema.crmSettings.id, current.id))
    .returning();
  return updated;
}
