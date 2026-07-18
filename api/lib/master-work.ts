import { db } from "../database";
import * as schema from "../database/schema";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { forTenant, tenantId } from "./tenant-query";

const OPEN_STATUSES = [
  "new", "quoted", "in_progress", "waiting_parts", "on_lift", "qc", "ready",
] as const;

export type DefectPhoto = {
  url: string;
  createdAt: string;
  userId: number;
};

export function parseDefectPhotos(raw: string | null | undefined): DefectPhoto[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is DefectPhoto =>
      !!p && typeof p === "object" && typeof (p as DefectPhoto).url === "string",
    );
  } catch {
    return [];
  }
}

/** Список ЗН для мастера: assigned / executor, иначе все открытые service ЗН. */
export async function listMasterDeals(userId: number) {
  const assigned = await db
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      status: schema.deals.status,
      vehiclePlate: schema.deals.vehiclePlate,
      vehicleMake: schema.deals.vehicleMake,
      vehicleModel: schema.deals.vehicleModel,
      vin: schema.deals.vin,
      mileage: schema.deals.mileage,
      amount: schema.deals.amount,
      assignedTo: schema.deals.assignedTo,
      defectPhotos: schema.deals.defectPhotos,
      updatedAt: schema.deals.updatedAt,
    })
    .from(schema.deals)
    .where(and(
      forTenant(schema.deals),
      eq(schema.deals.orderType, "service"),
      inArray(schema.deals.status, [...OPEN_STATUSES]),
      or(
        eq(schema.deals.assignedTo, userId),
        sql`exists (
          select 1 from deal_labor_items li
          where li.deal_id = ${schema.deals.id} and li.executor_user_id = ${userId}
        )`,
      ),
    ))
    .orderBy(desc(schema.deals.updatedAt))
    .limit(100);

  if (assigned.length) return assigned;

  return db
    .select({
      id: schema.deals.id,
      title: schema.deals.title,
      status: schema.deals.status,
      vehiclePlate: schema.deals.vehiclePlate,
      vehicleMake: schema.deals.vehicleMake,
      vehicleModel: schema.deals.vehicleModel,
      vin: schema.deals.vin,
      mileage: schema.deals.mileage,
      amount: schema.deals.amount,
      assignedTo: schema.deals.assignedTo,
      defectPhotos: schema.deals.defectPhotos,
      updatedAt: schema.deals.updatedAt,
    })
    .from(schema.deals)
    .where(and(
      forTenant(schema.deals),
      eq(schema.deals.orderType, "service"),
      inArray(schema.deals.status, [...OPEN_STATUSES]),
    ))
    .orderBy(desc(schema.deals.updatedAt))
    .limit(50);
}

export async function getActiveWorkSession(dealId: number, userId: number) {
  const [row] = await db
    .select()
    .from(schema.dealWorkSessions)
    .where(and(
      forTenant(schema.dealWorkSessions),
      eq(schema.dealWorkSessions.dealId, dealId),
      eq(schema.dealWorkSessions.userId, userId),
      isNull(schema.dealWorkSessions.endedAt),
    ))
    .orderBy(desc(schema.dealWorkSessions.startedAt))
    .limit(1);
  return row ?? null;
}

export async function startWorkSession(dealId: number, userId: number) {
  const existing = await getActiveWorkSession(dealId, userId);
  if (existing) return existing;
  const now = new Date();
  const [row] = await db
    .insert(schema.dealWorkSessions)
    .values({
      tenantId: tenantId(),
      dealId,
      userId,
      startedAt: now,
      endedAt: null,
      createdAt: now,
    })
    .returning();
  return row!;
}

export async function stopWorkSession(dealId: number, userId: number, sessionId?: number) {
  const active = sessionId
    ? (await db.select().from(schema.dealWorkSessions).where(and(
        forTenant(schema.dealWorkSessions),
        eq(schema.dealWorkSessions.id, sessionId),
        eq(schema.dealWorkSessions.dealId, dealId),
        eq(schema.dealWorkSessions.userId, userId),
      )).limit(1))[0]
    : await getActiveWorkSession(dealId, userId);

  if (!active || active.endedAt) return null;

  const [row] = await db
    .update(schema.dealWorkSessions)
    .set({ endedAt: new Date() })
    .where(eq(schema.dealWorkSessions.id, active.id))
    .returning();
  return row ?? null;
}

export async function appendDefectPhoto(dealId: number, userId: number, url: string) {
  const [deal] = await db
    .select()
    .from(schema.deals)
    .where(and(forTenant(schema.deals), eq(schema.deals.id, dealId)))
    .limit(1);
  if (!deal) return null;

  const photos = parseDefectPhotos(deal.defectPhotos);
  photos.push({ url, createdAt: new Date().toISOString(), userId });
  const [updated] = await db
    .update(schema.deals)
    .set({ defectPhotos: JSON.stringify(photos), updatedAt: new Date() })
    .where(and(forTenant(schema.deals), eq(schema.deals.id, dealId)))
    .returning();
  return updated;
}
