import { db } from "../database";
import * as schema from "../database/schema";
import { eq, inArray } from "drizzle-orm";
import { phonesMatch } from "./phone-normalize";

export const WO_STAGES = [
  { id: "reception", label: "Приём", statuses: ["new", "quoted"] },
  { id: "workshop", label: "В цеху", statuses: ["in_progress", "waiting_parts", "on_lift", "qc"] },
  { id: "ready", label: "Готов к выдаче", statuses: ["ready", "shipped"] },
  { id: "closed", label: "Закрыт", statuses: ["done", "cancelled"] },
] as const;

export type WoStageId = (typeof WO_STAGES)[number]["id"];

export function stageForStatus(status: string): WoStageId {
  const found = WO_STAGES.find((s) => s.statuses.includes(status as never));
  return found?.id ?? "reception";
}

export async function enrichServiceDeals(
  deals: Array<typeof schema.deals.$inferSelect & { clientName: string; clientPhone: string | null }>,
) {
  if (deals.length === 0) return [];

  const dealIds = deals.map((d) => d.id);
  const clientIds = [...new Set(deals.map((d) => d.clientId))];
  const assigneeIds = [...new Set(deals.map((d) => d.assignedTo).filter(Boolean))] as number[];

  const salesRows = await db.select().from(schema.salesDocuments);
  const paidByDeal = new Map<number, number>();
  for (const doc of salesRows) {
    if (!doc.dealId || !dealIds.includes(doc.dealId) || doc.status !== "posted") continue;
    paidByDeal.set(doc.dealId, (paidByDeal.get(doc.dealId) || 0) + (doc.paymentAmount ?? doc.totalAmount ?? 0));
  }

  const userMap = new Map<number, string>();
  for (const uid of assigneeIds) {
    const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, uid));
    if (u) userMap.set(uid, u.name);
  }

  const clientTagRows = await db
    .select({ clientId: schema.clientTags.clientId, tag: schema.tags })
    .from(schema.clientTags)
    .innerJoin(schema.tags, eq(schema.clientTags.tagId, schema.tags.id))
    .where(inArray(schema.clientTags.clientId, clientIds));

  const tagsByClient = new Map<number, { id: number; name: string; color: string | null }[]>();
  for (const row of clientTagRows) {
    const list = tagsByClient.get(row.clientId) || [];
    list.push({ id: row.tag.id, name: row.tag.name, color: row.tag.color });
    tagsByClient.set(row.clientId, list);
  }

  return deals.map((d) => {
    const paidFromDocs = paidByDeal.get(d.id) || 0;
    const paidCached = Number(d.paidAmount) || 0;
    const paidAmount = Math.round((paidCached > 0 ? paidCached : paidFromDocs) * 100) / 100;
    const total = d.amount ?? 0;
    const balance = Math.round((total - paidAmount) * 100) / 100;
    const paymentStatus = d.paymentStatus
      || (paidAmount <= 0 ? "unpaid" : balance <= 0.01 ? "paid" : "partial");
    return {
      ...d,
      assigneeName: d.assignedTo ? userMap.get(d.assignedTo) ?? null : null,
      paidAmount,
      balance,
      paymentStatus,
      hasDebt: balance > 0.01 && d.status !== "cancelled",
      stage: stageForStatus(d.status || "new"),
      clientTags: tagsByClient.get(d.clientId) || [],
    };
  });
}

export function filterByDate<T extends { createdAt: Date | null }>(
  deals: T[],
  dateFrom?: string,
  dateTo?: string,
): T[] {
  if (!dateFrom && !dateTo) return deals;
  const from = dateFrom ? new Date(dateFrom) : null;
  const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;
  return deals.filter((d) => {
    const t = d.createdAt ? new Date(d.createdAt).getTime() : 0;
    if (from && t < from.getTime()) return false;
    if (to && t > to.getTime()) return false;
    return true;
  });
}

export function filterBySearchScope<T extends {
  id: number;
  title: string | null;
  vin: string | null;
  vehiclePlate: string | null;
  clientName: string;
  clientPhone: string | null;
}>(
  deals: T[],
  search: string,
  scope: string,
): T[] {
  const q = search.toLowerCase();
  const qDigits = search.replace(/\D/g, "");
  return deals.filter((d) => {
    if (scope === "num") {
      return String(d.id).includes(q) || `зн-${d.id}`.includes(q);
    }
    if (scope === "vin") {
      return (d.vin || "").toLowerCase().includes(q) || (d.vehiclePlate || "").toLowerCase().includes(q);
    }
    if (scope === "client") {
      return d.clientName.toLowerCase().includes(q)
        || (qDigits.length >= 4 && phonesMatch(d.clientPhone, search));
    }
    return (
      !!d.title?.toLowerCase().includes(q)
      || !!d.vin?.toLowerCase().includes(q)
      || !!d.vehiclePlate?.toLowerCase().includes(q)
      || d.clientName.toLowerCase().includes(q)
      || !!(d.clientPhone && d.clientPhone.toLowerCase().includes(q))
      || (qDigits.length >= 4 && phonesMatch(d.clientPhone, search))
      || String(d.id).includes(q)
    );
  });
}
