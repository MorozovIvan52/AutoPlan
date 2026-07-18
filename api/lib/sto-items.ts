import { sqlAll } from "../database/raw-sql";

export type EnrichedOrderItem = {
  laborItemId: number | null;
  embeddedInLabor: boolean;
  reservedQty: number;
  stockPartId: number | null;
};

export async function enrichOrderItems<T extends { id: number }>(items: T[]): Promise<(T & EnrichedOrderItem)[]> {
  if (!items.length) return [];
  const ids = items.map((i) => i.id);
  const placeholders = ids.map(() => "?").join(",");
  const ext = await sqlAll<{
    id: number;
    labor_item_id: number;
    embedded_in_labor: number;
    reserved_qty: number;
    stock_part_id: number;
  }>(`
    SELECT id, labor_item_id, embedded_in_labor, reserved_qty, stock_part_id
    FROM order_items WHERE id IN (${placeholders})
  `, ...ids);
  const extMap = new Map(ext.map((e) => [e.id, e]));
  return items.map((it) => {
    const e = extMap.get(it.id);
    return {
      ...it,
      laborItemId: e?.labor_item_id ?? null,
      embeddedInLabor: !!e?.embedded_in_labor,
      reservedQty: e?.reserved_qty ?? 0,
      stockPartId: e?.stock_part_id ?? null,
    };
  });
}

export function printablePartItems<T extends { partSource?: string | null; embeddedInLabor?: boolean }>(items: T[]): T[] {
  return items.filter((i) => (i.partSource || "stock") !== "client" && !i.embeddedInLabor);
}
