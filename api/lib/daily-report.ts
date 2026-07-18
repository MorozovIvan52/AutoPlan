import { db } from "../database";
import * as schema from "../database/schema";
import { and, eq, gte, lt, inArray, isNull } from "drizzle-orm";
import { parseConvMetadata } from "./conv-meta";
import { forTenant, withTenant, tenantId } from "./tenant-query";

export type DailyReportDay = {
  date: string;
  chatsByAccount: { account: string; count: number; override?: number }[];
  totals: {
    chats: number;
    salesCount: number;
    salesAmount: number;
    ordersCount: number;
    callsInbound: number;
  };
  byOperator: {
    userId: number | null;
    userName: string;
    ordersCreated: number;
    salesCount: number;
    salesAmount: number;
    callsInbound: number;
  }[];
  overrides: Record<string, number>;
};

function parseDay(dateStr: string): { start: Date; end: Date } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const start = new Date(y, mo, d, 0, 0, 0, 0);
  const end = new Date(y, mo, d + 1, 0, 0, 0, 0);
  return { start, end };
}

function listDays(from: string, to: string): string[] {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end || start.start > end.start) return [];
  const days: string[] = [];
  const cur = new Date(start.start);
  while (cur <= end.start) {
    days.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return days;
}

function accountName(conv: typeof schema.conversations.$inferSelect, channelName?: string | null): string {
  const meta = parseConvMetadata(conv.metadata);
  if (meta?.avitoAccountName) return meta.avitoAccountName;
  if (channelName) return channelName;
  if (conv.channelType === "avito") return "Авито (без аккаунта)";
  return conv.channelType || "manual";
}

function overrideKey(metric: string, dimensionKey?: string | null) {
  return dimensionKey ? `${metric}:${dimensionKey}` : metric;
}

export async function buildDailyReport(from: string, to: string): Promise<DailyReportDay[]> {
  const days = listDays(from, to);
  if (!days.length) return [];

  const rangeStart = parseDay(from)!.start;
  const rangeEnd = parseDay(to)!.end;

  const [convs, deals, calls, overrides, users] = await Promise.all([
    db.select({
      conv: schema.conversations,
      channelName: schema.channels.name,
    })
      .from(schema.conversations)
      .leftJoin(schema.channels, eq(schema.conversations.channelId, schema.channels.id))
      .where(and(
        forTenant(schema.conversations),
        gte(schema.conversations.createdAt, rangeStart),
        lt(schema.conversations.createdAt, rangeEnd),
      )),
    db.select().from(schema.deals).where(and(
      forTenant(schema.deals),
      gte(schema.deals.createdAt, rangeStart),
      lt(schema.deals.createdAt, rangeEnd),
    )),
    db.select({
      call: schema.callLogs,
      userName: schema.users.name,
    })
      .from(schema.callLogs)
      .leftJoin(schema.users, eq(schema.callLogs.userId, schema.users.id))
      .where(and(
        forTenant(schema.callLogs),
        gte(schema.callLogs.createdAt, rangeStart),
        lt(schema.callLogs.createdAt, rangeEnd),
      )),
    db.select().from(schema.reportDailyOverrides).where(and(
      forTenant(schema.reportDailyOverrides),
      inArray(schema.reportDailyOverrides.reportDate, days),
    )),
    db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(forTenant(schema.users)),
  ]);

  const doneDeals = await db.select().from(schema.deals).where(and(
    forTenant(schema.deals),
    eq(schema.deals.status, "done"),
    gte(schema.deals.updatedAt, rangeStart),
    lt(schema.deals.updatedAt, rangeEnd),
  ));

  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  const overridesByDay = new Map<string, typeof overrides>();
  for (const o of overrides) {
    const list = overridesByDay.get(o.reportDate) || [];
    list.push(o);
    overridesByDay.set(o.reportDate, list);
  }

  return days.map((date) => {
    const bounds = parseDay(date)!;
    const dayOverrides = overridesByDay.get(date) || [];
    const ovMap: Record<string, number> = {};
    for (const o of dayOverrides) {
      ovMap[overrideKey(o.metric, o.dimensionKey)] = o.value;
    }

    const applyOv = (metric: string, raw: number, dimensionKey?: string) => {
      const k = overrideKey(metric, dimensionKey);
      return ovMap[k] !== undefined ? ovMap[k] : raw;
    };

    const accountCounts = new Map<string, number>();
    for (const { conv, channelName } of convs) {
      const t = conv.createdAt?.getTime() ?? 0;
      if (t < bounds.start.getTime() || t >= bounds.end.getTime()) continue;
      const acc = accountName(conv, channelName);
      accountCounts.set(acc, (accountCounts.get(acc) || 0) + 1);
    }

    const chatsByAccount = [...accountCounts.entries()]
      .map(([account, count]) => ({
        account,
        count: applyOv("chats_account", count, account),
        override: ovMap[overrideKey("chats_account", account)],
      }))
      .sort((a, b) => b.count - a.count);

    const rawChats = [...accountCounts.values()].reduce((s, n) => s + n, 0);

    const dayOrders = deals.filter((d) => {
      const t = d.createdAt?.getTime() ?? 0;
      return t >= bounds.start.getTime() && t < bounds.end.getTime();
    });

    const daySales = doneDeals.filter((d) => {
      const t = d.updatedAt?.getTime() ?? 0;
      return t >= bounds.start.getTime() && t < bounds.end.getTime();
    });

    const dayInbound = calls.filter(({ call }) => {
      if (call.direction !== "inbound") return false;
      const t = call.createdAt?.getTime() ?? 0;
      return t >= bounds.start.getTime() && t < bounds.end.getTime();
    });

    const opMap = new Map<number | null, {
      userId: number | null;
      userName: string;
      ordersCreated: number;
      salesCount: number;
      salesAmount: number;
      callsInbound: number;
    }>();

    const ensureOp = (userId: number | null, name?: string | null) => {
      if (!opMap.has(userId)) {
        opMap.set(userId, {
          userId,
          userName: name || (userId ? userNameById.get(userId) : null) || "Не назначен",
          ordersCreated: 0,
          salesCount: 0,
          salesAmount: 0,
          callsInbound: 0,
        });
      }
      return opMap.get(userId)!;
    };

    for (const d of dayOrders) {
      const op = ensureOp(d.assignedTo ?? null);
      op.ordersCreated += 1;
    }
    for (const d of daySales) {
      const op = ensureOp(d.assignedTo ?? null);
      op.salesCount += 1;
      op.salesAmount += d.amount || 0;
    }
    for (const { call, userName } of dayInbound) {
      const op = ensureOp(call.userId ?? null, userName);
      op.callsInbound += 1;
    }

    const byOperator = [...opMap.values()]
      .map((op) => ({
        ...op,
        ordersCreated: applyOv("operator_orders", op.ordersCreated, String(op.userId ?? "none")),
        salesCount: op.salesCount,
        salesAmount: op.salesAmount,
        callsInbound: applyOv("operator_calls", op.callsInbound, String(op.userId ?? "none")),
      }))
      .sort((a, b) => b.ordersCreated + b.callsInbound - (a.ordersCreated + a.callsInbound));

    const salesAmount = daySales.reduce((s, d) => s + (d.amount || 0), 0);

    return {
      date,
      chatsByAccount,
      totals: {
        chats: applyOv("chats_total", rawChats),
        salesCount: applyOv("sales_count", daySales.length),
        salesAmount: applyOv("sales_amount", salesAmount),
        ordersCount: applyOv("orders_count", dayOrders.length),
        callsInbound: applyOv("calls_inbound", dayInbound.length),
      },
      byOperator,
      overrides: ovMap,
    };
  });
}

export async function upsertDailyOverride(opts: {
  reportDate: string;
  metric: string;
  dimensionKey?: string | null;
  value: number;
  note?: string;
  userId: number;
}) {
  const dimCond = opts.dimensionKey
    ? eq(schema.reportDailyOverrides.dimensionKey, opts.dimensionKey)
    : isNull(schema.reportDailyOverrides.dimensionKey);

  const existing = await db.select().from(schema.reportDailyOverrides).where(and(
    forTenant(schema.reportDailyOverrides),
    eq(schema.reportDailyOverrides.reportDate, opts.reportDate),
    eq(schema.reportDailyOverrides.metric, opts.metric),
    dimCond,
  ));

  if (existing[0]) {
    const [row] = await db.update(schema.reportDailyOverrides)
      .set({
        value: opts.value,
        note: opts.note ?? existing[0].note,
        updatedBy: opts.userId,
        updatedAt: new Date(),
      })
      .where(withTenant(schema.reportDailyOverrides, eq(schema.reportDailyOverrides.id, existing[0].id)))
      .returning();
    return row;
  }

  const [row] = await db.insert(schema.reportDailyOverrides).values({
    tenantId: tenantId(),
    reportDate: opts.reportDate,
    metric: opts.metric,
    dimensionKey: opts.dimensionKey ?? null,
    value: opts.value,
    note: opts.note ?? null,
    updatedBy: opts.userId,
  }).returning();
  return row;
}

export async function deleteDailyOverride(id: number) {
  await db.delete(schema.reportDailyOverrides)
    .where(withTenant(schema.reportDailyOverrides, eq(schema.reportDailyOverrides.id, id)));
}
