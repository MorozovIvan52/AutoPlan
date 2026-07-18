import { sqlExec, tableColumns, tableExists } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

async function addColumnIfMissing(table: string, column: string, ddl: string) {
  if (!(await hasColumn(table, column))) {
    await sqlExec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

/** DDL для новых модулей и колонок на PostgreSQL (bootstrap SQLite не дублирует). */
export async function ensurePgExtensions(): Promise<void> {
  if (!(await tableExists("supplier_orders"))) {
    await sqlExec(`
      CREATE TABLE supplier_orders (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        supplier_slug TEXT NOT NULL,
        supplier_name TEXT NOT NULL,
        article TEXT NOT NULL,
        brand TEXT,
        name TEXT NOT NULL,
        qty BIGINT DEFAULT 1,
        price DOUBLE PRECISION,
        status TEXT DEFAULT 'draft',
        deal_id BIGINT REFERENCES deals(id) ON DELETE SET NULL,
        external_order_id TEXT,
        notes TEXT,
        ordered_at BIGINT,
        received_at BIGINT,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await sqlExec("CREATE INDEX idx_supplier_orders_status ON supplier_orders(status, created_at DESC)");
    await sqlExec("CREATE INDEX idx_supplier_orders_deal ON supplier_orders(deal_id)");
  }

  if (!(await tableExists("stock_inventory_sessions"))) {
    await sqlExec(`
      CREATE TABLE stock_inventory_sessions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        created_by BIGINT REFERENCES users(id),
        completed_at BIGINT,
        created_at BIGINT NOT NULL
      )
    `);
    await sqlExec(`
      CREATE TABLE stock_inventory_lines (
        id BIGSERIAL PRIMARY KEY,
        session_id BIGINT NOT NULL REFERENCES stock_inventory_sessions(id) ON DELETE CASCADE,
        part_id BIGINT REFERENCES parts_stock(id) ON DELETE SET NULL,
        article TEXT NOT NULL,
        brand TEXT,
        name TEXT,
        expected_qty BIGINT DEFAULT 0,
        counted_qty BIGINT,
        location TEXT
      )
    `);
    await sqlExec("CREATE INDEX idx_stock_inv_lines_session ON stock_inventory_lines(session_id)");
  }

  await addColumnIfMissing("parts_stock", "barcode", "barcode TEXT");
  await addColumnIfMissing("parts_stock", "purchase_price", "purchase_price DOUBLE PRECISION");
  await addColumnIfMissing("parts_stock", "reserved_qty", "reserved_qty BIGINT DEFAULT 0");
  await addColumnIfMissing("parts_stock", "markup_percent", "markup_percent DOUBLE PRECISION");
  await addColumnIfMissing("parts_stock", "unit", "unit TEXT DEFAULT 'шт'");
  await addColumnIfMissing("parts_stock", "country", "country TEXT");
  await addColumnIfMissing("parts_stock", "oem_articles", "oem_articles TEXT");

  if (!(await tableExists("parts_categories"))) {
    await sqlExec(`
      CREATE TABLE parts_categories (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        name TEXT NOT NULL,
        sort_order BIGINT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }
  await addColumnIfMissing("sales_documents", "ofd_receipt_id", "ofd_receipt_id TEXT");
  await addColumnIfMissing("sales_documents", "ofd_status", "ofd_status TEXT");
  await addColumnIfMissing("sales_documents", "onec_export_id", "onec_export_id TEXT");

  await addColumnIfMissing("crm_settings", "onec_enabled", "onec_enabled BOOLEAN DEFAULT false");
  await addColumnIfMissing("crm_settings", "onec_url", "onec_url TEXT");
  await addColumnIfMissing("crm_settings", "onec_token", "onec_token TEXT");
  await addColumnIfMissing("crm_settings", "ofd_enabled", "ofd_enabled BOOLEAN DEFAULT false");
  await addColumnIfMissing("crm_settings", "ofd_provider", "ofd_provider TEXT DEFAULT 'atol'");
  await addColumnIfMissing("crm_settings", "ofd_token", "ofd_token TEXT");
  await addColumnIfMissing("crm_settings", "ofd_group_code", "ofd_group_code TEXT");

  await addColumnIfMissing("clients", "discount_percent", "discount_percent BIGINT DEFAULT 0");
  await addColumnIfMissing("clients", "loyalty_card", "loyalty_card TEXT");
  await addColumnIfMissing("service_settings", "bay_count", "bay_count BIGINT DEFAULT 4");
  await addColumnIfMissing("service_settings", "online_booking_enabled", "online_booking_enabled BOOLEAN DEFAULT true");
  await addColumnIfMissing("service_settings", "notify_sms", "notify_sms BOOLEAN DEFAULT false");
  await addColumnIfMissing("service_appointments", "bay_number", "bay_number BIGINT");
  await addColumnIfMissing("deals", "discount_amount", "discount_amount DOUBLE PRECISION DEFAULT 0");
  await addColumnIfMissing("deals", "defect_photos", "defect_photos TEXT");
  await addColumnIfMissing("deals", "payment_status", "payment_status TEXT DEFAULT 'unpaid'");
  await addColumnIfMissing("deals", "paid_amount", "paid_amount DOUBLE PRECISION DEFAULT 0");

  await sqlExec("CREATE INDEX IF NOT EXISTS idx_deals_tenant_payment ON deals(tenant_id, payment_status, status)");
  await sqlExec("CREATE INDEX IF NOT EXISTS idx_deals_tenant_enterprise_updated ON deals(tenant_id, wo_enterprise_id, updated_at)");
  await sqlExec("CREATE INDEX IF NOT EXISTS idx_sales_docs_deal ON sales_documents(deal_id)");

  await addColumnIfMissing("tenant_usage", "vin_decodes_used", "vin_decodes_used BIGINT DEFAULT 0");
  await addColumnIfMissing("tenant_usage", "stock_skus_active", "stock_skus_active BIGINT DEFAULT 0");
  await addColumnIfMissing("tenant_usage", "call_minutes_used", "call_minutes_used BIGINT DEFAULT 0");

  if (!(await tableExists("deal_work_sessions"))) {
    await sqlExec(`
      CREATE TABLE deal_work_sessions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL DEFAULT 1,
        deal_id BIGINT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id),
        started_at BIGINT NOT NULL,
        ended_at BIGINT,
        created_at BIGINT
      )
    `);
    await sqlExec("CREATE INDEX idx_deal_work_sessions_deal ON deal_work_sessions(deal_id, user_id)");
  }
}
