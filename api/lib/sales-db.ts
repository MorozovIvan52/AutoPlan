import { db } from "../database";
import * as schema from "../database/schema";
import { and, eq } from "drizzle-orm";
import { getCrmSettings } from "./crm-settings";
import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";
import { forTenant, withTenant } from "./tenant-query";
import type { DbExecutor } from "./db-transaction";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureSalesTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS sales_documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      doc_type TEXT NOT NULL,
      doc_number TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
      deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
      manager_id INTEGER REFERENCES users(id),
      company_name TEXT,
      recipient_name TEXT,
      recipient_phone TEXT,
      notes TEXT,
      warranty_text TEXT,
      payment_method TEXT,
      payment_amount REAL,
      rounding REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      posted_at INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sales_document_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      document_id INTEGER NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
      stock_part_id INTEGER REFERENCES parts_stock(id) ON DELETE SET NULL,
      article TEXT,
      brand TEXT,
      name TEXT NOT NULL,
      qty INTEGER DEFAULT 1,
      price REAL,
      sort_order INTEGER DEFAULT 0
    );
  `);

  for (const col of [
    "company_name TEXT",
    "company_address TEXT",
    "company_phone TEXT",
    "company_inn TEXT",
    "warranty_templates TEXT",
  ]) {
    const name = col.split(" ")[0];
    if (!(await hasColumn("crm_settings", name))) {
      await sqlExec(`ALTER TABLE crm_settings ADD COLUMN ${col}`);
    }
  }
  if (!(await hasColumn("sales_documents", "warranty_text"))) {
    await sqlExec("ALTER TABLE sales_documents ADD COLUMN warranty_text TEXT");
  }
  if (!(await hasColumn("sales_documents", "tenant_id"))) {
    await sqlExec("ALTER TABLE sales_documents ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1");
    await sqlExec("UPDATE sales_documents SET tenant_id = 1 WHERE tenant_id IS NULL OR tenant_id = 0");
  }
}

export function calcItemsTotal(items: { qty?: number | null; price?: number | null }[], rounding = 0): number {
  const sum = items.reduce((s, i) => s + (i.qty || 1) * (i.price || 0), 0);
  return Math.round((sum + (rounding || 0)) * 100) / 100;
}

export async function nextDocNumber(
  docType: "receipt" | "invoice",
  conn: DbExecutor = db,
): Promise<string> {
  const rows = await conn.select({ docNumber: schema.salesDocuments.docNumber })
    .from(schema.salesDocuments)
    .where(and(forTenant(schema.salesDocuments), eq(schema.salesDocuments.docType, docType)));

  let maxNum = 0;
  for (const d of rows) {
    if (/^\d+$/.test(d.docNumber)) {
      const n = parseInt(d.docNumber, 10);
      if (n > maxNum) maxNum = n;
    }
  }
  return String(maxNum + 1);
}

export async function defaultCompanyName(): Promise<string> {
  const settings = await getCrmSettings();
  return settings.companyName?.trim() || process.env.COMPANY_NAME?.trim() || "CRM АвтоПлан";
}

export async function recalcDocumentTotal(documentId: number, conn: DbExecutor = db) {
  const [doc] = await conn.select().from(schema.salesDocuments)
    .where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, documentId)));
  if (!doc) return;
  const items = await conn.select().from(schema.salesDocumentItems)
    .where(eq(schema.salesDocumentItems.documentId, documentId));
  const total = calcItemsTotal(items, doc.rounding ?? 0);
  await conn.update(schema.salesDocuments).set({
    totalAmount: total,
    updatedAt: new Date(),
  }).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, documentId)));
  return total;
}

export async function deductStockForDocument(
  documentId: number,
  conn: DbExecutor = db,
): Promise<{ deducted: number; skippedNoStockPartId: number }> {
  const [doc] = await conn.select().from(schema.salesDocuments)
    .where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, documentId)));
  if (!doc) {
    throw Object.assign(new Error("Документ не найден"), { code: "DOC_NOT_FOUND", status: 404 });
  }

  const items = await conn.select().from(schema.salesDocumentItems)
    .where(eq(schema.salesDocumentItems.documentId, documentId));
  let deducted = 0;
  let skippedNoStockPartId = 0;
  for (const item of items) {
    if (!item.stockPartId) {
      skippedNoStockPartId += 1;
      continue;
    }
    const [part] = await conn.select().from(schema.partsStock)
      .where(withTenant(schema.partsStock, eq(schema.partsStock.id, item.stockPartId)));
    if (!part) continue;
    const nextQty = Math.max(0, (part.qty || 0) - (item.qty || 1));
    await conn.update(schema.partsStock).set({ qty: nextQty, updatedAt: new Date() })
      .where(withTenant(schema.partsStock, eq(schema.partsStock.id, part.id)));
    deducted += 1;
  }
  return { deducted, skippedNoStockPartId };
}

/** Строгое списание: при нехватке остатка бросает ошибку (чеки / закрытие ЗН). */
export async function deductStockForDocumentStrict(
  documentId: number,
  conn: DbExecutor = db,
): Promise<{ deducted: number; skippedNoStockPartId: number }> {
  const [doc] = await conn.select().from(schema.salesDocuments)
    .where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, documentId)));
  if (!doc) {
    throw Object.assign(new Error("Документ не найден"), { code: "DOC_NOT_FOUND", status: 404 });
  }

  const items = await conn.select().from(schema.salesDocumentItems)
    .where(eq(schema.salesDocumentItems.documentId, documentId));

  let skippedNoStockPartId = 0;
  for (const item of items) {
    if (!item.stockPartId) {
      skippedNoStockPartId += 1;
      continue;
    }
    const [part] = await conn.select().from(schema.partsStock)
      .where(withTenant(schema.partsStock, eq(schema.partsStock.id, item.stockPartId)));
    if (!part) {
      throw Object.assign(new Error(`Товар #${item.stockPartId} не найден на складе`), { code: "STOCK_NOT_FOUND", status: 409 });
    }
    const need = item.qty || 1;
    if ((part.qty || 0) < need) {
      throw Object.assign(
        new Error(`Недостаточно остатка «${part.name}»: нужно ${need}, есть ${part.qty || 0}`),
        { code: "INSUFFICIENT_STOCK", status: 409 },
      );
    }
  }

  return deductStockForDocument(documentId, conn);
}

export async function restoreStockForDocument(documentId: number) {
  const [doc] = await db.select().from(schema.salesDocuments)
    .where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, documentId)));
  if (!doc) return;

  const items = await db.select().from(schema.salesDocumentItems)
    .where(eq(schema.salesDocumentItems.documentId, documentId));
  for (const item of items) {
    if (!item.stockPartId) continue;
    const [part] = await db.select().from(schema.partsStock)
      .where(withTenant(schema.partsStock, eq(schema.partsStock.id, item.stockPartId)));
    if (!part) continue;
    await db.update(schema.partsStock).set({
      qty: (part.qty || 0) + (item.qty || 1),
      updatedAt: new Date(),
    }).where(withTenant(schema.partsStock, eq(schema.partsStock.id, part.id)));
  }
}
