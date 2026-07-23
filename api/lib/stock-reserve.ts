import { sqlGet, sqlAll, sqlRun } from "../database/raw-sql";
import { tenantId } from "./tenant-query";
import { db } from "../database";
import * as schema from "../database/schema";
import { and, eq, gt } from "drizzle-orm";
import type { DbExecutor } from "./db-transaction";

export async function logStockMovement(
  partId: number,
  qtyDelta: number,
  reason: string,
  refType?: string,
  refId?: number,
) {
  const tid = tenantId();
  const part = await sqlGet<{ qty: number }>(
    "SELECT qty FROM parts_stock WHERE id = ? AND tenant_id = ?",
    partId,
    tid,
  );
  const balance = part?.qty ?? 0;
  await sqlRun(`
    INSERT INTO stock_movements (part_id, qty_delta, balance_after, reason, ref_type, ref_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, partId, qtyDelta, balance, reason, refType ?? null, refId ?? null, Date.now());
}

/**
 * Атомарный резерв: UPDATE с условием по свободному остатку.
 * Два параллельных запроса не уйдут в минус — второй получит changes=0.
 */
export async function reserveStockForDealItem(
  stockPartId: number,
  qty: number,
  dealId: number,
  orderItemId: number,
) {
  if (qty <= 0) throw new Error("Количество резерва должно быть > 0");
  const tid = tenantId();
  const result = await sqlRun(
    `UPDATE parts_stock
     SET reserved_qty = COALESCE(reserved_qty, 0) + ?
     WHERE id = ? AND tenant_id = ?
       AND (qty - COALESCE(reserved_qty, 0)) >= ?`,
    qty,
    stockPartId,
    tid,
    qty,
  );
  if (result.changes === 0) {
    const part = await sqlGet<{ qty: number; reserved_qty: number }>(
      "SELECT qty, reserved_qty FROM parts_stock WHERE id = ? AND tenant_id = ?",
      stockPartId,
      tid,
    );
    if (!part) throw new Error("Товар не найден на складе");
    const available = part.qty - (part.reserved_qty || 0);
    throw new Error(`Недостаточно свободного остатка (доступно ${available})`);
  }
  await sqlRun(
    "UPDATE order_items SET reserved_qty = ?, stock_part_id = ? WHERE id = ?",
    qty,
    stockPartId,
    orderItemId,
  );
  await logStockMovement(stockPartId, 0, `Резерв ${qty} шт. по ЗН #${dealId}`, "deal_reserve", dealId);
}

export async function releaseReserveForDealItem(stockPartId: number, qty: number, dealId: number) {
  if (!stockPartId || qty <= 0) return;
  const tid = tenantId();
  await sqlRun(
    `UPDATE parts_stock
     SET reserved_qty = CASE
       WHEN COALESCE(reserved_qty, 0) <= ? THEN 0
       ELSE COALESCE(reserved_qty, 0) - ?
     END
     WHERE id = ? AND tenant_id = ?`,
    qty,
    qty,
    stockPartId,
    tid,
  );
  await logStockMovement(stockPartId, 0, `Снят резерв ${qty} шт. по ЗН #${dealId}`, "deal_reserve_release", dealId);
}

export async function releaseAllReservesForDeal(dealId: number, conn: DbExecutor = db) {
  const tid = tenantId();
  const items = await conn
    .select({
      id: schema.orderItems.id,
      stockPartId: schema.orderItems.stockPartId,
      reservedQty: schema.orderItems.reservedQty,
    })
    .from(schema.orderItems)
    .innerJoin(schema.deals, eq(schema.deals.id, schema.orderItems.dealId))
    .where(and(
      eq(schema.orderItems.dealId, dealId),
      eq(schema.deals.tenantId, tid),
      gt(schema.orderItems.reservedQty, 0),
    ));

  for (const item of items) {
    const stockPartId = item.stockPartId;
    const qty = item.reservedQty ?? 0;
    if (!stockPartId || qty <= 0) continue;
    await releaseReserveForDealItem(stockPartId, qty, dealId);
    await conn.update(schema.orderItems)
      .set({ reservedQty: 0 })
      .where(eq(schema.orderItems.id, item.id));
  }
}

export function applyMarkup(purchasePrice: number, markupPercent: number | null | undefined): number {
  const pct = markupPercent ?? 30;
  return Math.round(purchasePrice * (1 + pct / 100) * 100) / 100;
}
