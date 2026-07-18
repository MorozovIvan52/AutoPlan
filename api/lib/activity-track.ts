import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, gte, lt, sql, desc, or, isNull, gt } from "drizzle-orm";
import { moscowDayBounds } from "./moscow-time";

export type ActivityEventType =
  | "login"
  | "logout"
  | "chat_assigned"
  | "chat_opened"
  | "message_sent"
  | "task_created"
  | "task_done"
  | "deal_created"
  | "deal_status"
  | "sales_posted"
  | "buyout_created"
  | "call_logged"
  | "appointment_created";

const touchThrottle = new Map<string, number>();

function sessionMinutesInRange(
  loginAt: Date,
  logoutAt: Date | null,
  lastActivityAt: Date | null,
  start: Date,
  end: Date,
): number {
  const sessionEnd = logoutAt || lastActivityAt || new Date();
  const from = Math.max(loginAt.getTime(), start.getTime());
  const to = Math.min(sessionEnd.getTime(), end.getTime());
  return Math.max(0, Math.round((to - from) / 60_000));
}

export async function trackLoginSession(opts: {
  userId: number;
  sessionId: string;
  ip?: string;
  userAgent?: string;
}) {
  const now = new Date();
  await db.insert(schema.userLoginSessions).values({
    userId: opts.userId,
    sessionId: opts.sessionId,
    ip: opts.ip || null,
    userAgent: opts.userAgent?.slice(0, 512) || null,
    loginAt: now,
    lastActivityAt: now,
  });
  await trackActivityEvent(opts.userId, "login", undefined, undefined, { sessionId: opts.sessionId });
}

export async function trackLogoutSession(sessionId: string | undefined) {
  if (!sessionId) return;
  const now = new Date();
  const [row] = await db.select().from(schema.userLoginSessions)
    .where(and(eq(schema.userLoginSessions.sessionId, sessionId), sql`${schema.userLoginSessions.logoutAt} IS NULL`))
    .orderBy(desc(schema.userLoginSessions.loginAt))
    .limit(1);
  if (!row) return;
  await db.update(schema.userLoginSessions).set({ logoutAt: now, lastActivityAt: now })
    .where(eq(schema.userLoginSessions.id, row.id));
  await trackActivityEvent(row.userId, "logout");
}

export async function touchSessionActivity(sessionId: string | undefined, userId?: number) {
  if (!sessionId || !userId) return;
  const now = Date.now();
  const last = touchThrottle.get(sessionId) || 0;
  if (now - last < 120_000) return;
  touchThrottle.set(sessionId, now);

  const updated = await db.update(schema.userLoginSessions).set({ lastActivityAt: new Date() })
    .where(and(eq(schema.userLoginSessions.sessionId, sessionId), isNull(schema.userLoginSessions.logoutAt)))
    .returning({ id: schema.userLoginSessions.id });

  if (!updated.length) {
    await db.insert(schema.userLoginSessions).values({
      userId,
      sessionId,
      loginAt: new Date(),
      lastActivityAt: new Date(),
    });
  }
}

/** Создать записи сессий для уже залогиненных пользователей (до включения трекинга). */
export async function backfillOpenLoginSessions(): Promise<number> {
  const openSessions = await db.select().from(schema.sessions)
    .where(gt(schema.sessions.expiresAt, new Date()));
  let created = 0;
  for (const s of openSessions) {
    const [exists] = await db.select({ id: schema.userLoginSessions.id })
      .from(schema.userLoginSessions)
      .where(and(eq(schema.userLoginSessions.sessionId, s.id), isNull(schema.userLoginSessions.logoutAt)))
      .limit(1);
    if (exists) continue;
    const loginAt = s.expiresAt ? new Date(Math.min(Date.now(), s.expiresAt.getTime() - 60_000)) : new Date();
    await db.insert(schema.userLoginSessions).values({
      userId: s.userId,
      sessionId: s.id,
      loginAt,
      lastActivityAt: new Date(),
    });
    created++;
  }
  return created;
}

export async function trackActivityEvent(
  userId: number,
  eventType: ActivityEventType,
  entityType?: string,
  entityId?: number,
  meta?: Record<string, unknown>,
) {
  if (!userId) return;
  await db.insert(schema.userActivityEvents).values({
    userId,
    eventType,
    entityType: entityType || null,
    entityId: entityId ?? null,
    meta: meta ? JSON.stringify(meta) : null,
    createdAt: new Date(),
  });
}

export async function buildDailyUserActivity(dateStr: string) {
  const { start, end } = moscowDayBounds(dateStr);
  const { forTenant } = await import("./tenant-query");
  const users = await db.select().from(schema.users)
    .where(and(forTenant(schema.users), eq(schema.users.isActive, true)));

  const sessions = await db.select().from(schema.userLoginSessions).where(
    and(
      lt(schema.userLoginSessions.loginAt, end),
      or(
        isNull(schema.userLoginSessions.logoutAt),
        gte(schema.userLoginSessions.logoutAt, start),
        gte(schema.userLoginSessions.lastActivityAt, start),
      ),
    ),
  );

  const events = await db.select().from(schema.userActivityEvents)
    .where(and(gte(schema.userActivityEvents.createdAt, start), lt(schema.userActivityEvents.createdAt, end)));

  const eventCounts = new Map<number, Record<string, number>>();
  for (const e of events) {
    const bucket = eventCounts.get(e.userId) || {};
    bucket[e.eventType] = (bucket[e.eventType] || 0) + 1;
    eventCounts.set(e.userId, bucket);
  }

  const dealsCreated = await db.select({
    userId: schema.deals.assignedTo,
    cnt: sql<number>`count(*)`,
  }).from(schema.deals)
    .where(and(forTenant(schema.deals), gte(schema.deals.createdAt, start), lt(schema.deals.createdAt, end)))
    .groupBy(schema.deals.assignedTo);

  const dealsDone = await db.select({
    userId: schema.deals.assignedTo,
    cnt: sql<number>`count(*)`,
  }).from(schema.deals)
    .where(and(
      forTenant(schema.deals),
      gte(schema.deals.updatedAt, start),
      lt(schema.deals.updatedAt, end),
      eq(schema.deals.status, "done"),
    ))
    .groupBy(schema.deals.assignedTo);

  const tasksCreated = await db.select({
    userId: schema.tasks.createdBy,
    cnt: sql<number>`count(*)`,
  }).from(schema.tasks)
    .where(and(forTenant(schema.tasks), gte(schema.tasks.createdAt, start), lt(schema.tasks.createdAt, end)))
    .groupBy(schema.tasks.createdBy);

  const tasksDone = await db.select({
    userId: schema.tasks.assignedTo,
    cnt: sql<number>`count(*)`,
  }).from(schema.tasks)
    .where(and(
      forTenant(schema.tasks),
      gte(schema.tasks.updatedAt, start),
      lt(schema.tasks.updatedAt, end),
      eq(schema.tasks.status, "done"),
    ))
    .groupBy(schema.tasks.assignedTo);

  const messagesSent = await db.select({
    userId: schema.messages.senderId,
    cnt: sql<number>`count(*)`,
    lastAt: sql<number>`max(${schema.messages.createdAt})`,
  }).from(schema.messages)
    .where(and(
      gte(schema.messages.createdAt, start),
      lt(schema.messages.createdAt, end),
      eq(schema.messages.senderType, "operator"),
    ))
    .groupBy(schema.messages.senderId);

  const salesPosted = await db.select({
    userId: schema.salesDocuments.managerId,
    cnt: sql<number>`count(*)`,
    total: sql<number>`COALESCE(SUM(${schema.salesDocuments.totalAmount}), 0)`,
  }).from(schema.salesDocuments)
    .where(and(
      gte(schema.salesDocuments.postedAt, start),
      lt(schema.salesDocuments.postedAt, end),
      eq(schema.salesDocuments.status, "posted"),
    ))
    .groupBy(schema.salesDocuments.managerId);

  const buyouts = await db.select({
    userId: schema.partsBuyouts.createdBy,
    cnt: sql<number>`count(*)`,
    total: sql<number>`COALESCE(SUM(${schema.partsBuyouts.amount}), 0)`,
  }).from(schema.partsBuyouts)
    .where(and(gte(schema.partsBuyouts.createdAt, start), lt(schema.partsBuyouts.createdAt, end)))
    .groupBy(schema.partsBuyouts.createdBy);

  const calls = await db.select({
    userId: schema.callLogs.userId,
    cnt: sql<number>`count(*)`,
  }).from(schema.callLogs)
    .where(and(gte(schema.callLogs.createdAt, start), lt(schema.callLogs.createdAt, end)))
    .groupBy(schema.callLogs.userId);

  const mapCount = (rows: { userId: number | null; cnt: number }[]) => {
    const m = new Map<number, number>();
    for (const r of rows) {
      if (r.userId) m.set(r.userId, Number(r.cnt) || 0);
    }
    return m;
  };

  const mapLastAt = (rows: { userId: number | null; lastAt: unknown }[]) => {
    const m = new Map<number, Date>();
    for (const r of rows) {
      if (!r.userId || r.lastAt == null) continue;
      const d = r.lastAt instanceof Date ? r.lastAt : new Date(Number(r.lastAt));
      if (!Number.isNaN(d.getTime())) m.set(r.userId, d);
    }
    return m;
  };

  const mapSum = (rows: { userId: number | null; cnt: number; total?: number }[]) => {
    const m = new Map<number, { count: number; total: number }>();
    for (const r of rows) {
      if (r.userId) m.set(r.userId, { count: Number(r.cnt) || 0, total: Number(r.total) || 0 });
    }
    return m;
  };

  const dc = mapCount(dealsCreated);
  const dd = mapCount(dealsDone);
  const tc = mapCount(tasksCreated);
  const td = mapCount(tasksDone);
  const ms = mapCount(messagesSent);
  const msLast = mapLastAt(messagesSent);
  const sp = mapSum(salesPosted);
  const bo = mapSum(buyouts);
  const cl = mapCount(calls);

  const rows = users.map((u) => {
    const ev = eventCounts.get(u.id) || {};
    const userSessions = sessions.filter((s) => s.userId === u.id);
    const totalMinutes = userSessions.reduce(
      (sum, s) => sum + sessionMinutesInRange(s.loginAt, s.logoutAt, s.lastActivityAt, start, end),
      0,
    );

    const lastMessageAt = msLast.get(u.id) || null;
    const lastSessionAt = userSessions.reduce<Date | null>((max, s) => {
      const t = s.lastActivityAt || s.loginAt;
      if (!t) return max;
      return !max || t > max ? t : max;
    }, null);
    const lastActiveAt = [lastMessageAt, lastSessionAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] || null;

    const stats = {
      chatsAssigned: ev.chat_assigned || 0,
      messagesSent: ms.get(u.id) || ev.message_sent || 0,
      dealsCreated: dc.get(u.id) || ev.deal_created || 0,
      dealsDone: dd.get(u.id) || 0,
      tasksCreated: tc.get(u.id) || ev.task_created || 0,
      tasksDone: td.get(u.id) || ev.task_done || 0,
      salesPosted: sp.get(u.id)?.count || ev.sales_posted || 0,
      salesTotal: sp.get(u.id)?.total || 0,
      buyouts: bo.get(u.id)?.count || ev.buyout_created || 0,
      buyoutsTotal: bo.get(u.id)?.total || 0,
      calls: cl.get(u.id) || ev.call_logged || 0,
      logins: ev.login || 0,
    };

    const hasActivity = totalMinutes > 0
      || userSessions.length > 0
      || stats.messagesSent > 0
      || Object.values(stats).some((v) => v > 0)
      || Object.keys(ev).length > 0;

    return {
      userId: u.id,
      userName: u.name,
      role: u.role,
      hasActivity,
      lastActiveAt,
      sessions: userSessions.map((s) => ({
        id: s.id,
        loginAt: s.loginAt,
        logoutAt: s.logoutAt,
        lastActivityAt: s.lastActivityAt,
        ip: s.ip,
        minutes: sessionMinutesInRange(s.loginAt, s.logoutAt, s.lastActivityAt, start, end),
        active: !s.logoutAt,
      })),
      totalOnlineMinutes: totalMinutes,
      events: ev,
      stats,
    };
  });

  rows.sort((a, b) => {
    if (a.hasActivity !== b.hasActivity) return a.hasActivity ? -1 : 1;
    return b.totalOnlineMinutes - a.totalOnlineMinutes;
  });

  return rows;
}
