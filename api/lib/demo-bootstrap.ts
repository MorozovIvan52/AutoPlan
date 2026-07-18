import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureDemoColumns() {
  if (usePostgres()) return;
  if (!(await hasColumn("clients", "is_demo"))) {
    await sqlExec("ALTER TABLE clients ADD COLUMN is_demo INTEGER DEFAULT 0");
  }
  if (!(await hasColumn("parts_stock", "is_demo"))) {
    await sqlExec("ALTER TABLE parts_stock ADD COLUMN is_demo INTEGER DEFAULT 0");
  }
  await sqlExec("CREATE INDEX IF NOT EXISTS idx_clients_is_demo ON clients(is_demo)");
}
