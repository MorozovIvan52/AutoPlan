import { db } from "../database";
import * as schema from "../database/schema";
import { and, desc, eq, inArray, ne, or, sql } from "drizzle-orm";
import { forTenant } from "./tenant-query";

export type VinPartsHistoryItem = {
  dealId: number;
  dealTitle: string;
  date: string | null;
  mileage: number | null;
  itemType: "part" | "labor";
  name: string;
  article: string | null;
  price: number | null;
  qty: number | null;
  laborName: string | null;
};

export type VinPartsRecommendation = {
  name: string;
  article: string | null;
  timesSeen: number;
};

export type VinPartsHistoryResult = {
  vin: string;
  items: VinPartsHistoryItem[];
  recommendations: VinPartsRecommendation[];
};

export function normalizeVin(vin: string): string {
  return vin.trim().toUpperCase();
}

export function isValidVinParam(vin: string): boolean {
  const v = normalizeVin(vin);
  return v.length >= 11 && v.length <= 17 && /^[A-HJ-NPR-Z0-9]+$/.test(v);
}

function buildRecommendations(items: VinPartsHistoryItem[]): VinPartsRecommendation[] {
  const counts = new Map<string, VinPartsRecommendation>();
  for (const item of items) {
    if (item.itemType !== "part") continue;
    const name = (item.name || "").trim();
    if (!name) continue;
    const article = item.article?.trim() || null;
    const key = `${name.toLowerCase()}|${(article || "").toLowerCase()}`;
    const prev = counts.get(key);
    if (prev) {
      prev.timesSeen += 1;
    } else {
      counts.set(key, { name, article, timesSeen: 1 });
    }
  }
  return [...counts.values()]
    .filter((r) => r.timesSeen >= 2)
    .sort((a, b) => b.timesSeen - a.timesSeen || a.name.localeCompare(b.name, "ru"))
    .slice(0, 10);
}

/** История запчастей и работ по VIN (все ЗН тенанта, кроме отменённых). */
export async function getVinPartsHistory(vinRaw: string): Promise<VinPartsHistoryResult> {
  const vin = normalizeVin(vinRaw);
  if (!vin) return { vin: "", items: [], recommendations: [] };

  const dealRows = await db
    .select({ deal: schema.deals })
    .from(schema.deals)
    .leftJoin(schema.vehicles, eq(schema.deals.vehicleId, schema.vehicles.id))
    .where(and(
      forTenant(schema.deals),
      eq(schema.deals.orderType, "service"),
      ne(schema.deals.status, "cancelled"),
      or(
        sql`upper(coalesce(${schema.deals.vin}, '')) = ${vin}`,
        sql`upper(coalesce(${schema.vehicles.vin}, '')) = ${vin}`,
      ),
    ))
    .orderBy(desc(schema.deals.updatedAt));

  const dealIds = dealRows.map((r) => r.deal.id);
  if (dealIds.length === 0) return { vin, items: [], recommendations: [] };

  const dealById = new Map(dealRows.map((r) => [r.deal.id, r.deal]));

  const [parts, labor] = await Promise.all([
    db.select().from(schema.orderItems).where(inArray(schema.orderItems.dealId, dealIds)),
    db.select().from(schema.dealLaborItems).where(inArray(schema.dealLaborItems.dealId, dealIds)),
  ]);

  const items: VinPartsHistoryItem[] = [];

  for (const p of parts) {
    const deal = dealById.get(p.dealId);
    if (!deal) continue;
    items.push({
      dealId: p.dealId,
      dealTitle: deal.title ?? `ЗН-${p.dealId}`,
      date: deal.updatedAt ? new Date(deal.updatedAt).toISOString() : null,
      mileage: deal.mileage ?? null,
      itemType: "part",
      name: p.name ?? "",
      article: p.article ?? null,
      price: p.price ?? null,
      qty: p.qty ?? null,
      laborName: null,
    });
  }

  for (const l of labor) {
    const deal = dealById.get(l.dealId);
    if (!deal) continue;
    items.push({
      dealId: l.dealId,
      dealTitle: deal.title ?? `ЗН-${l.dealId}`,
      date: deal.updatedAt ? new Date(deal.updatedAt).toISOString() : null,
      mileage: deal.mileage ?? null,
      itemType: "labor",
      name: l.name ?? "",
      article: l.code ?? null,
      price: l.price ?? null,
      qty: l.hours ?? l.normHours ?? null,
      laborName: l.name ?? null,
    });
  }

  items.sort((a, b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });

  return { vin, items, recommendations: buildRecommendations(items) };
}
