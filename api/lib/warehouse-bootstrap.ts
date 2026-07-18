import { sqlExec, tableColumns, tableExists, usePostgres } from "../database/raw-sql";
import { ensurePgExtensions } from "./pg-extensions-bootstrap";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureWarehouseModules(): Promise<void> {
  if (usePostgres()) {
    await ensurePgExtensions();
    return;
  }

  if (!(await tableExists("supplier_orders"))) {
    await sqlExec(`
      CREATE TABLE IF NOT EXISTS supplier_orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        supplier_slug TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        article TEXT NOT NULL,
        brand TEXT,
        name TEXT NOT NULL,
        qty INTEGER DEFAULT 1,
        price REAL,
        status TEXT DEFAULT 'draft',
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        external_order_id TEXT,
        notes TEXT,
        ordered_at INTEGER,
        received_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_supplier_orders_status ON supplier_orders(status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_supplier_orders_deal ON supplier_orders(deal_id);
    `);
  }

  if (!(await tableExists("stock_inventory_sessions"))) {
    await sqlExec(`
      CREATE TABLE IF NOT EXISTS stock_inventory_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        created_by INTEGER REFERENCES users(id),
        completed_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS stock_inventory_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL REFERENCES stock_inventory_sessions(id) ON DELETE CASCADE,
        part_id INTEGER REFERENCES parts_stock(id) ON DELETE SET NULL,
        article TEXT NOT NULL,
        brand TEXT,
        name TEXT,
        expected_qty INTEGER DEFAULT 0,
        counted_qty INTEGER,
        location TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_stock_inv_lines_session ON stock_inventory_lines(session_id);
    `);
  }

  if (!(await hasColumn("parts_stock", "barcode"))) {
    await sqlExec("ALTER TABLE parts_stock ADD COLUMN barcode TEXT");
  }
  if (!(await hasColumn("sales_documents", "ofd_receipt_id"))) {
    await sqlExec("ALTER TABLE sales_documents ADD COLUMN ofd_receipt_id TEXT");
  }
  if (!(await hasColumn("sales_documents", "ofd_status"))) {
    await sqlExec("ALTER TABLE sales_documents ADD COLUMN ofd_status TEXT");
  }
  if (!(await hasColumn("sales_documents", "onec_export_id"))) {
    await sqlExec("ALTER TABLE sales_documents ADD COLUMN onec_export_id TEXT");
  }
  if (!(await hasColumn("crm_settings", "onec_enabled"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN onec_enabled INTEGER DEFAULT 0");
  }
  if (!(await hasColumn("crm_settings", "onec_url"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN onec_url TEXT");
  }
  if (!(await hasColumn("crm_settings", "onec_token"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN onec_token TEXT");
  }
  if (!(await hasColumn("crm_settings", "ofd_enabled"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN ofd_enabled INTEGER DEFAULT 0");
  }
  if (!(await hasColumn("crm_settings", "ofd_provider"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN ofd_provider TEXT DEFAULT 'atol'");
  }
  if (!(await hasColumn("crm_settings", "ofd_token"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN ofd_token TEXT");
  }
  if (!(await hasColumn("crm_settings", "ofd_group_code"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN ofd_group_code TEXT");
  }
}
