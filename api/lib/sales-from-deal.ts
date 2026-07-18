import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { recalcDealTotals } from "./deal-totals";
import { recalcDocumentTotal } from "./sales-db";
import type { DbExecutor } from "./db-transaction";

type SalesLine = {
  article: string | null;
  brand: string | null;
  name: string;
  qty: number;
  price: number;
  sortOrder: number;
  stockPartId: number | null;
};

/** Копирует позиции ЗН (запчасти + работы) в товарный чек с учётом скидки лояльности. */
export async function insertSalesItemsFromDeal(
  documentId: number,
  dealId: number,
  conn: DbExecutor = db,
): Promise<number> {
  await recalcDealTotals(dealId);

  const [deal] = await conn.select().from(schema.deals).where(eq(schema.deals.id, dealId));
  if (!deal) return 0;

  const orderItems = await conn.select().from(schema.orderItems).where(eq(schema.orderItems.dealId, dealId));
  const labor = await conn.select().from(schema.dealLaborItems).where(eq(schema.dealLaborItems.dealId, dealId));

  const lines: SalesLine[] = [];
  let sortOrder = 0;

  for (const oi of orderItems) {
    if ((oi.partSource || "stock") === "client") continue;
    lines.push({
      article: oi.article,
      brand: oi.brand,
      name: oi.name,
      qty: oi.qty ?? 1,
      price: oi.price ?? 0,
      sortOrder: sortOrder++,
      stockPartId: oi.stockPartId ?? null,
    });
  }

  for (const l of labor) {
    lines.push({
      article: l.code,
      brand: null,
      name: l.name,
      qty: 1,
      price: l.price ?? 0,
      sortOrder: sortOrder++,
      stockPartId: null,
    });
  }

  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const discount = deal.discountAmount ?? 0;
  if (discount > 0 && subtotal > 0) {
    const factor = Math.max(0, (subtotal - discount) / subtotal);
    for (const l of lines) {
      l.price = Math.round(l.price * factor * 100) / 100;
    }
  }

  for (const line of lines) {
    await conn.insert(schema.salesDocumentItems).values({
      documentId,
      stockPartId: line.stockPartId,
      article: line.article,
      brand: line.brand,
      name: line.name,
      qty: line.qty,
      price: line.price,
      sortOrder: line.sortOrder,
    });
  }

  if (lines.length > 0) {
    await recalcDocumentTotal(documentId, conn);
  }

  return lines.length;
}
