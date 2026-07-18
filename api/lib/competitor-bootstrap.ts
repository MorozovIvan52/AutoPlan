import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";
import { ensurePgExtensions } from "./pg-extensions-bootstrap";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

/** Колонки для паритета с АвтоДилер / STOCRM */
export async function ensureCompetitorColumns(): Promise<void> {
  if (usePostgres()) {
    await ensurePgExtensions();
    return;
  }

  if (!(await hasColumn("clients", "discount_percent"))) {
    await sqlExec("ALTER TABLE clients ADD COLUMN discount_percent INTEGER DEFAULT 0");
  }
  if (!(await hasColumn("clients", "loyalty_card"))) {
    await sqlExec("ALTER TABLE clients ADD COLUMN loyalty_card TEXT");
  }
  if (!(await hasColumn("service_settings", "bay_count"))) {
    await sqlExec("ALTER TABLE service_settings ADD COLUMN bay_count INTEGER DEFAULT 4");
  }
  if (!(await hasColumn("service_settings", "online_booking_enabled"))) {
    await sqlExec("ALTER TABLE service_settings ADD COLUMN online_booking_enabled INTEGER DEFAULT 1");
  }
  if (!(await hasColumn("service_settings", "notify_sms"))) {
    await sqlExec("ALTER TABLE service_settings ADD COLUMN notify_sms INTEGER DEFAULT 0");
  }
  if (!(await hasColumn("service_appointments", "bay_number"))) {
    await sqlExec("ALTER TABLE service_appointments ADD COLUMN bay_number INTEGER");
  }
  if (!(await hasColumn("deals", "discount_amount"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN discount_amount REAL DEFAULT 0");
  }
}
