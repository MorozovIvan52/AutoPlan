/**
 * Bootstrap таблицы documents и реквизитов для PDF-печати.
 */
import { sqlExec, tableColumns, tableExists, usePostgres } from "../database/raw-sql";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const cols = await tableColumns(table);
  return cols.some((c) => c.name === column);
}

async function addColumn(table: string, column: string, ddl: string): Promise<void> {
  if (!(await hasColumn(table, column))) {
    await sqlExec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

export async function ensureDocumentsSchema(): Promise<void> {
  const exists = await tableExists("documents");
  if (!exists) {
    if (usePostgres()) {
      await sqlExec(`
        CREATE TABLE documents (
          id BIGSERIAL PRIMARY KEY,
          tenant_id BIGINT NOT NULL DEFAULT 1,
          deal_id BIGINT,
          type TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          doc_number TEXT,
          pdf_path TEXT,
          file_name TEXT,
          issued_at BIGINT,
          signed_at BIGINT,
          created_by BIGINT,
          created_at BIGINT
        )
      `);
    } else {
      await sqlExec(`
        CREATE TABLE IF NOT EXISTS documents (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL DEFAULT 1,
          deal_id INTEGER,
          type TEXT NOT NULL,
          status TEXT DEFAULT 'draft',
          doc_number TEXT,
          pdf_path TEXT,
          file_name TEXT,
          issued_at INTEGER,
          signed_at INTEGER,
          created_by INTEGER,
          created_at INTEGER
        )
      `);
    }
  }

  await sqlExec(
    usePostgres()
      ? "CREATE INDEX IF NOT EXISTS idx_documents_tenant_deal_type ON documents(tenant_id, deal_id, type)"
      : "CREATE INDEX IF NOT EXISTS idx_documents_tenant_deal_type ON documents(tenant_id, deal_id, type)",
  );

  for (const [col, ddl] of [
    ["company_kpp", "company_kpp TEXT"],
    ["company_bank", "company_bank TEXT"],
    ["company_bik", "company_bik TEXT"],
    ["company_rs", "company_rs TEXT"],
    ["company_ks", "company_ks TEXT"],
    ["vat_mode", "vat_mode TEXT DEFAULT 'with_vat_20'"],
    ["sbp_pay_payload", "sbp_pay_payload TEXT"],
  ] as const) {
    await addColumn("crm_settings", col, ddl);
  }

  for (const [col, ddl] of [
    ["client_inn", "client_inn TEXT"],
    ["client_kpp", "client_kpp TEXT"],
    ["legal_address", "legal_address TEXT"],
  ] as const) {
    await addColumn("clients", col, ddl);
  }
}
