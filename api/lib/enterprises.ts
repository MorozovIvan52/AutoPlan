import { db } from "../database";
import * as schema from "../database/schema";
import { eq, asc } from "drizzle-orm";
import { getCrmSettings } from "./crm-settings";
import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureEnterpriseTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS sto_enterprises (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER
    );
  `);
  if (!(await hasColumn("deals", "company_name"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN company_name TEXT");
  }
  if (!(await hasColumn("deals", "wo_enterprise_id"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN wo_enterprise_id INTEGER");
  }
}

export async function listEnterprises() {
  await ensureEnterpriseTables();
  let rows = await db.select().from(schema.stoEnterprises)
    .where(eq(schema.stoEnterprises.isActive, true))
    .orderBy(asc(schema.stoEnterprises.name));

  if (rows.length === 0) {
    const settings = await getCrmSettings();
    const name = settings.companyName?.trim() || "СТО";
    const [created] = await db.insert(schema.stoEnterprises).values({
      name,
      isDefault: true,
      isActive: true,
    }).returning();
    rows = [created];
  }
  return rows;
}

export async function defaultEnterpriseId(): Promise<number> {
  const list = await listEnterprises();
  const def = list.find((e) => e.isDefault) || list[0];
  return def.id;
}
