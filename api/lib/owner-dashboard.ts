import { db } from "../database";
import * as schema from "../database/schema";
import { and, eq, gte, inArray, lt, ne, sql } from "drizzle-orm";
import { forTenant } from "./tenant-query";
import { sqlGet } from "../database/raw-sql";
import { getTenantId } from "./tenant-context";

export type OwnerDashboardMetrics = {
  bayLoadPercent: number;
  appointmentsToday: number;
  bayCount: number;
  avgCheck: number | null;
  avgCheckCount: number;
  callToBookingConversionPercent: number | null;
  inboundCalls: number;
  convertedCalls: number;
  lowStockCount: number;
  activeReservesCount: number;
};

function monthBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start, end };
}

function dayBounds(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 86400000);
  return { start, end };
}

export async function getOwnerDashboardMetrics(): Promise<OwnerDashboardMetrics> {
  const tid = getTenantId();
  const now = new Date();
  const { start: dayStart, end: dayEnd } = dayBounds(now);
  const { start: monthStart, end: monthEnd } = monthBounds(now);

  const settings = await db
    .select()
    .from(schema.serviceSettings)
    .where(forTenant(schema.serviceSettings))
    .limit(1);
  const bayCount = Math.max(1, Number(settings[0]?.bayCount) || 4);

  const appointmentsTodayRows = await db
    .select({ id: schema.serviceAppointments.id })
    .from(schema.serviceAppointments)
    .where(and(
      forTenant(schema.serviceAppointments),
      gte(schema.serviceAppointments.scheduledAt, dayStart),
      lt(schema.serviceAppointments.scheduledAt, dayEnd),
      ne(schema.serviceAppointments.status, "cancelled"),
    ));
  const appointmentsToday = appointmentsTodayRows.length;
  const bayLoadPercent = Math.min(100, Math.round((appointmentsToday / (bayCount * 6)) * 100));

  const avgRow = await db
    .select({
      avg: sql<number>`avg(${schema.deals.amount})`,
      cnt: sql<number>`count(*)`,
    })
    .from(schema.deals)
    .where(and(
      forTenant(schema.deals),
      eq(schema.deals.orderType, "service"),
      ne(schema.deals.status, "cancelled"),
      gte(schema.deals.createdAt, monthStart),
      lt(schema.deals.createdAt, monthEnd),
    ));
  const avgCheckCount = Number(avgRow[0]?.cnt) || 0;
  const avgRaw = avgRow[0]?.avg;
  const avgCheck = avgCheckCount > 0 && avgRaw != null ? Math.round(Number(avgRaw) * 100) / 100 : null;

  const inboundCalls = await db
    .select({
      id: schema.callLogs.id,
      clientId: schema.callLogs.clientId,
      createdAt: schema.callLogs.createdAt,
    })
    .from(schema.callLogs)
    .where(and(
      forTenant(schema.callLogs),
      eq(schema.callLogs.direction, "inbound"),
      gte(schema.callLogs.createdAt, monthStart),
      lt(schema.callLogs.createdAt, monthEnd),
    ));

  let convertedCalls = 0;
  const clientIds = [...new Set(inboundCalls.map((c) => c.clientId).filter((id): id is number => id != null))];
  if (clientIds.length) {
    const appointments = await db
      .select({
        clientId: schema.serviceAppointments.clientId,
        scheduledAt: schema.serviceAppointments.scheduledAt,
        createdAt: schema.serviceAppointments.createdAt,
      })
      .from(schema.serviceAppointments)
      .where(and(
        forTenant(schema.serviceAppointments),
        inArray(schema.serviceAppointments.clientId, clientIds),
        ne(schema.serviceAppointments.status, "cancelled"),
      ));

    const deals = await db
      .select({
        clientId: schema.deals.clientId,
        createdAt: schema.deals.createdAt,
      })
      .from(schema.deals)
      .where(and(
        forTenant(schema.deals),
        eq(schema.deals.orderType, "service"),
        inArray(schema.deals.clientId, clientIds),
        ne(schema.deals.status, "cancelled"),
      ));

    for (const call of inboundCalls) {
      if (call.clientId == null || !call.createdAt) continue;
      const callTs = new Date(call.createdAt).getTime();
      const windowEnd = callTs + 7 * 86400000;
      const hasAppt = appointments.some((a) => {
        if (a.clientId !== call.clientId) return false;
        const t = new Date(a.createdAt || a.scheduledAt).getTime();
        return t >= callTs && t <= windowEnd;
      });
      const hasDeal = deals.some((d) => {
        if (d.clientId !== call.clientId || !d.createdAt) return false;
        const t = new Date(d.createdAt).getTime();
        return t >= callTs && t <= windowEnd;
      });
      if (hasAppt || hasDeal) convertedCalls += 1;
    }
  }

  const callToBookingConversionPercent = inboundCalls.length
    ? Math.round((convertedCalls / inboundCalls.length) * 1000) / 10
    : null;

  const lowStock = await sqlGet<{ cnt: number }>(`
    SELECT COUNT(*) as cnt FROM parts_stock
    WHERE tenant_id = ? AND qty <= COALESCE(min_qty, 1)
  `, tid);

  let activeReservesCount = 0;
  try {
    const reserves = await sqlGet<{ cnt: number }>(`
      SELECT COUNT(*) as cnt FROM parts_stock
      WHERE tenant_id = ? AND COALESCE(reserved_qty, 0) > 0
    `, tid);
    activeReservesCount = Number(reserves?.cnt) || 0;
  } catch {
    activeReservesCount = 0;
  }

  return {
    bayLoadPercent,
    appointmentsToday,
    bayCount,
    avgCheck,
    avgCheckCount,
    callToBookingConversionPercent,
    inboundCalls: inboundCalls.length,
    convertedCalls,
    lowStockCount: Number(lowStock?.cnt) || 0,
    activeReservesCount,
  };
}
