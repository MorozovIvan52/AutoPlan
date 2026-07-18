import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { getCrmSettings } from "./crm-settings";
import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureDealLaborTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS deal_labor_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      code TEXT,
      name TEXT NOT NULL,
      norm_hours REAL DEFAULT 1,
      hours REAL,
      hourly_rate REAL,
      price REAL,
      executor_name TEXT,
      executor_user_id INTEGER,
      payroll_percent REAL,
      sort_order INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_deal_labor_deal ON deal_labor_items(deal_id);
  `);
  for (const col of [
    "executor_user_id INTEGER",
    "payroll_percent REAL",
  ]) {
    const name = col.split(" ")[0];
    if (!(await hasColumn("deal_labor_items", name))) {
      await sqlExec(`ALTER TABLE deal_labor_items ADD COLUMN ${col}`);
    }
  }
  if (!(await hasColumn("crm_settings", "default_labor_rate"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN default_labor_rate INTEGER DEFAULT 2500");
  }
  for (const col of [
    "vehicle_make TEXT",
    "vehicle_model TEXT",
    "vehicle_year INTEGER",
    "vehicle_plate TEXT",
    "mileage INTEGER",
  ]) {
    const name = col.split(" ")[0];
    if (!(await hasColumn("deals", name))) await sqlExec(`ALTER TABLE deals ADD COLUMN ${col}`);
  }
  if (!(await hasColumn("order_items", "part_source"))) {
    await sqlExec("ALTER TABLE order_items ADD COLUMN part_source TEXT DEFAULT 'stock'");
  }
  for (const col of [
    "vehicle_value REAL",
    "client_is_payer INTEGER DEFAULT 1",
    "wo_group TEXT",
    "campaign TEXT",
    "appointment_id INTEGER",
    "wo_note TEXT",
    "warranty_obligations TEXT",
    "contract_terms TEXT",
    "inspection_report TEXT",
  ]) {
    const name = col.split(" ")[0];
    if (!(await hasColumn("deals", name))) await sqlExec(`ALTER TABLE deals ADD COLUMN ${col}`);
  }
}

export function calcLaborLinePrice(
  item: { normHours?: number | null; hours?: number | null; hourlyRate?: number | null },
  defaultRate: number,
): number {
  const h = item.hours ?? item.normHours ?? 1;
  const rate = item.hourlyRate ?? defaultRate;
  return Math.round(h * rate * 100) / 100;
}

export async function getDefaultLaborRate(): Promise<number> {
  const settings = await getCrmSettings();
  return settings.defaultLaborRate ?? 2500;
}

export async function recalcDealTotals(dealId: number) {
  const [deal] = await db.select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) return { partsCost: 0, laborCost: 0, amount: 0, discountAmount: 0 };

  const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.dealId, dealId));
  const labor = await db.select().from(schema.dealLaborItems).where(eq(schema.dealLaborItems.dealId, dealId));
  const partsCost = Math.round(items
    .filter((i) => (i.partSource || "stock") !== "client")
    .reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0) * 100) / 100;
  const laborCost = Math.round(labor.reduce((s, l) => s + (l.price || 0), 0) * 100) / 100;
  const subtotal = Math.round((partsCost + laborCost) * 100) / 100;

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, deal.clientId));
  const discountPct = Math.min(100, Math.max(0, client?.discountPercent ?? 0));
  const discountAmount = discountPct > 0
    ? Math.round(subtotal * discountPct / 100 * 100) / 100
    : 0;
  const amount = Math.round((subtotal - discountAmount) * 100) / 100;

  await db.update(schema.deals).set({ partsCost, laborCost, discountAmount, amount, updatedAt: new Date() })
    .where(eq(schema.deals.id, dealId));
  return { partsCost, laborCost, amount, discountAmount };
}
