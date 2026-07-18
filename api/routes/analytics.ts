import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { sql, eq, and, gte, lt, inArray, desc, or, isNotNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getChatSla } from "../lib/chat-sla";
import { cdekShipmentPhase } from "../lib/cdek-status";
import { fetchAvitoCpaStatus } from "../services/avito-cpa-monitor";
import { buildDailyReport, upsertDailyOverride, deleteDailyOverride } from "../lib/daily-report";
import { forTenant } from "../lib/tenant-query";

export const analytics = new Hono()
  .use("*", requireAuth)
  .get("/overview", requireAdmin, async (c) => {
    const [totalClients] = await db.select({ count: sql<number>`count(*)` }).from(schema.clients)
      .where(forTenant(schema.clients));
    const [openConvs] = await db.select({ count: sql<number>`count(*)` }).from(schema.conversations)
      .where(and(forTenant(schema.conversations), eq(schema.conversations.status, "open")));
    const [closedConvs] = await db.select({ count: sql<number>`count(*)` }).from(schema.conversations)
      .where(and(forTenant(schema.conversations), eq(schema.conversations.status, "closed")));
    const [totalMessages] = await db.select({ count: sql<number>`count(*)` }).from(schema.messages)
      .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
      .where(forTenant(schema.conversations));
    const [doneDeals] = await db.select({ count: sql<number>`count(*)` }).from(schema.deals)
      .where(and(forTenant(schema.deals), eq(schema.deals.status, "done")));
    const [totalDeals] = await db.select({ count: sql<number>`count(*)` }).from(schema.deals)
      .where(forTenant(schema.deals));

    const bySource = await db
      .select({ source: schema.clients.source, count: sql<number>`count(*)` })
      .from(schema.clients)
      .where(forTenant(schema.clients))
      .groupBy(schema.clients.source);

    const byStatus = await db
      .select({ status: schema.conversations.status, count: sql<number>`count(*)` })
      .from(schema.conversations)
      .where(forTenant(schema.conversations))
      .groupBy(schema.conversations.status);

    const byOperator = await db
      .select({
        userId: schema.conversations.assignedTo,
        userName: schema.users.name,
        count: sql<number>`count(*)`,
      })
      .from(schema.conversations)
      .leftJoin(schema.users, eq(schema.conversations.assignedTo, schema.users.id))
      .where(forTenant(schema.conversations))
      .groupBy(schema.conversations.assignedTo, schema.users.name)
      .limit(10);

    const allDeals = await db.select().from(schema.deals).where(forTenant(schema.deals));
    const partsOrders = allDeals.filter((d) => d.orderType === "parts").length;
    const serviceOrders = allDeals.filter((d) => d.orderType === "service").length;
    const avitoOrders = allDeals.filter((d) => d.avitoItemId).length;
    const revenue = allDeals.filter((d) => d.status === "done").reduce((s, d) => s + (d.amount || 0), 0);
    const stock = await db.select().from(schema.partsStock).where(forTenant(schema.partsStock));
    const lowStock = stock.filter((p) => (p.qty ?? 0) <= (p.minQty || 1)).length;

    return c.json({
      overview: {
        totalClients: Number(totalClients.count),
        openConversations: Number(openConvs.count),
        closedConversations: Number(closedConvs.count),
        totalMessages: Number(totalMessages.count),
        doneDeals: Number(doneDeals.count),
        totalDeals: Number(totalDeals.count),
        partsOrders,
        serviceOrders,
        avitoOrders,
        revenue,
        lowStock,
        stockItems: stock.length,
      },
      bySource,
      byStatus,
      byOperator,
    }, 200);
  })
  .get("/today", requireAdmin, async (c) => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const convRows = await db
      .select({ conv: schema.conversations, client: schema.clients })
      .from(schema.conversations)
      .innerJoin(schema.clients, eq(schema.conversations.clientId, schema.clients.id))
      .where(and(forTenant(schema.conversations), eq(schema.conversations.status, "open")));

    const convIds = convRows.map((r) => r.conv.id);
    const lastMessageByConv = new Map<number, typeof schema.messages.$inferSelect>();
    if (convIds.length > 0) {
      const msgRows = await db.select().from(schema.messages)
        .where(inArray(schema.messages.conversationId, convIds))
        .orderBy(desc(schema.messages.createdAt));
      for (const row of msgRows) {
        if (!lastMessageByConv.has(row.conversationId)) {
          lastMessageByConv.set(row.conversationId, row);
        }
      }
    }

    let unreadChats = 0;
    let noReply30 = 0;
    let slaOk = 0;
    let slaWarn = 0;
    let slaDanger = 0;
    const urgent: { id: number; clientName: string; minutes: number; level: string }[] = [];

    for (const { conv, client } of convRows) {
      const lm = lastMessageByConv.get(conv.id) || null;
      const unread = conv.unreadCount || 0;
      if (unread > 0) unreadChats += 1;

      const sla = getChatSla(unread, lm, conv.lastMessageAt);
      if (sla.level === "ok") slaOk += 1;
      if (sla.level === "warn") slaWarn += 1;
      if (sla.level === "danger") slaDanger += 1;
      if (sla.minutes >= 30 && sla.level) noReply30 += 1;

      if (sla.level && (sla.level === "warn" || sla.level === "danger") && unread > 0) {
        urgent.push({
          id: conv.id,
          clientName: client.name,
          minutes: sla.minutes,
          level: sla.level,
        });
      }
    }

    urgent.sort((a, b) => b.minutes - a.minutes);

    const cdekDeals = await db.select({
      cdekStatus: schema.deals.cdekStatus,
    }).from(schema.deals).where(and(
      forTenant(schema.deals),
      or(
        isNotNull(schema.deals.cdekTrackNumber),
        isNotNull(schema.deals.cdekOrderUuid),
      ),
    ));

    const cdekAtPvz = cdekDeals.filter((d) => cdekShipmentPhase(d.cdekStatus) === "at_pvz").length;

    const taskRows = await db.select().from(schema.tasks).where(
      and(
        forTenant(schema.tasks),
        inArray(schema.tasks.status, ["todo", "in_progress"]),
        gte(schema.tasks.dueAt, startOfDay),
        lt(schema.tasks.dueAt, endOfDay),
      ),
    );

    const buyoutRows = await db.select().from(schema.partsBuyouts).where(
      and(
        forTenant(schema.partsBuyouts),
        gte(schema.partsBuyouts.boughtAt, monthStart),
        lt(schema.partsBuyouts.boughtAt, monthEnd),
      ),
    );
    const buyoutTotal = buyoutRows.reduce((s, r) => s + (r.amount || 0), 0);

    const [newClientsToday] = await db.select({ count: sql<number>`count(*)` }).from(schema.clients)
      .where(and(forTenant(schema.clients), gte(schema.clients.createdAt, startOfDay)));

    const [messagesToday] = await db.select({ count: sql<number>`count(*)` }).from(schema.messages)
      .where(gte(schema.messages.createdAt, startOfDay));

    const avitoCpa = await fetchAvitoCpaStatus().catch(() => ({
      configured: false,
      accounts: [],
      level: "unknown" as const,
      threshold: 200,
      alertsEnabled: true,
    }));

    return c.json({
      today: {
        unreadChats,
        noReply30,
        slaOk,
        slaWarn,
        slaDanger,
        cdekAtPvz,
        tasksDueToday: taskRows.length,
        buyoutMonthTotal: buyoutTotal,
        buyoutMonthCount: buyoutRows.length,
        newClientsToday: Number(newClientsToday.count),
        messagesToday: Number(messagesToday.count),
        avitoCpaAdvance: "advance" in avitoCpa ? avitoCpa.advance ?? null : null,
        avitoCpaLevel: avitoCpa.level,
        avitoCpaThreshold: avitoCpa.threshold ?? null,
        avitoAccountsCount: avitoCpa.accounts?.length ?? 0,
        avitoCpaLowCount: avitoCpa.accounts?.filter((a) => a.level === "low").length ?? 0,
        avitoCpaEmptyCount: avitoCpa.accounts?.filter((a) => a.level === "empty").length ?? 0,
      },
      avitoCpa,
      urgentChats: urgent.slice(0, 8),
      tasksToday: taskRows.slice(0, 5).map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        dueAt: t.dueAt?.toISOString() ?? null,
      })),
    }, 200);
  })

  .get("/vehicles", async (c) => {
    const deals = await db
      .select({
        id: schema.deals.id,
        vehicleId: schema.deals.vehicleId,
        vehicleMake: schema.deals.vehicleMake,
        vehicleModel: schema.deals.vehicleModel,
        vehicleYear: schema.deals.vehicleYear,
        vehiclePlate: schema.deals.vehiclePlate,
        mileage: schema.deals.mileage,
        vin: schema.deals.vin,
        status: schema.deals.status,
        orderType: schema.deals.orderType,
      })
      .from(schema.deals)
      .where(and(forTenant(schema.deals), eq(schema.deals.orderType, "service")));

    // Актуальные ЗН: всё кроме отменённых
    const activeZn = deals.filter((d) => d.status !== "cancelled");

    const vehicleIds = [...new Set(activeZn.map((d) => d.vehicleId).filter((id): id is number => id != null))];
    const vehicleRows = vehicleIds.length
      ? await db.select().from(schema.vehicles).where(inArray(schema.vehicles.id, vehicleIds))
      : [];
    const vehicleById = new Map(vehicleRows.map((v) => [v.id, v]));

    type Car = {
      key: string;
      make: string;
      model: string;
      year: number | null;
      mileage: number | null;
      znIds: Set<number>;
    };

    const cars = new Map<string, Car>();

    const norm = (s: string | null | undefined) => (s || "").trim();

    for (const d of activeZn) {
      const v = d.vehicleId != null ? vehicleById.get(d.vehicleId) : undefined;
      const make = norm(v?.make) || norm(d.vehicleMake);
      const model = norm(v?.model) || norm(d.vehicleModel);
      const vin = norm(v?.vin) || norm(d.vin);
      const plate = norm(v?.plate) || norm(d.vehiclePlate);
      const year = v?.year ?? d.vehicleYear ?? null;
      const mileage = v?.mileage ?? d.mileage ?? null;

      // Ключ актуальной машины: id карточки → VIN → госномер → марка+модель+год
      let key: string;
      if (d.vehicleId != null) key = `id:${d.vehicleId}`;
      else if (vin.length >= 8) key = `vin:${vin.toUpperCase()}`;
      else if (plate) key = `plate:${plate.toUpperCase().replace(/\s+/g, "")}`;
      else if (make || model) key = `mm:${make.toLowerCase()}|${model.toLowerCase()}|${year ?? ""}`;
      else continue; // пустая машина без идентификаторов — пропускаем

      const cur = cars.get(key) || {
        key,
        make: make || "Не указано",
        model,
        year,
        mileage,
        znIds: new Set<number>(),
      };
      cur.znIds.add(d.id);
      if (!cur.make || cur.make === "Не указано") cur.make = make || cur.make;
      if (!cur.model && model) cur.model = model;
      if (cur.year == null && year != null) cur.year = year;
      if ((cur.mileage == null || cur.mileage <= 0) && mileage != null && mileage > 0) cur.mileage = mileage;
      cars.set(key, cur);
    }

    type Agg = { label: string; count: number; deals: number };
    const brands = new Map<string, Agg>();
    const models = new Map<string, Agg>();

    const bump = (map: Map<string, Agg>, label: string, znCount: number) => {
      const cur = map.get(label) || { label, count: 0, deals: 0 };
      cur.count += 1;
      cur.deals += znCount;
      map.set(label, cur);
    };

    for (const car of cars.values()) {
      const makeLabel = car.make || "Не указано";
      const modelLabel = car.model
        ? `${makeLabel === "Не указано" ? "" : `${makeLabel} `}${car.model}`.trim()
        : makeLabel;
      bump(brands, makeLabel, car.znIds.size);
      bump(models, modelLabel, car.znIds.size);
    }

    const sortAgg = (a: Agg, b: Agg) => b.count - a.count || b.deals - a.deals || a.label.localeCompare(b.label, "ru");
    const popularBrands = [...brands.values()].sort(sortAgg).slice(0, 25);
    const popularModels = [...models.values()].sort(sortAgg).slice(0, 25);

    const carList = [...cars.values()];
    const mileages = carList.map((c) => c.mileage).filter((m): m is number => m != null && m > 0);
    const avgMileage = mileages.length
      ? Math.round(mileages.reduce((s, m) => s + m, 0) / mileages.length)
      : null;

    const nowY = new Date().getFullYear();
    const ages = carList
      .map((c) => c.year)
      .filter((y): y is number => y != null && y >= 1950 && y <= nowY)
      .map((y) => nowY - y);
    const avgAgeYears = ages.length
      ? Math.round((ages.reduce((s, a) => s + a, 0) / ages.length) * 10) / 10
      : null;

    return c.json({
      totalVehicles: carList.length,
      totalZn: activeZn.length,
      avgMileage,
      avgAgeYears,
      popularModels,
      popularBrands,
      vehicleTypes: carList.length ? [{ label: "По заказ-нарядам", count: carList.length }] : [],
    }, 200);
  })

  .get("/daily-report", requireAdmin, async (c) => {
    const from = c.req.query("from") || new Date().toISOString().slice(0, 10);
    const to = c.req.query("to") || from;
    const days = await buildDailyReport(from, to);
    const avitoAccounts = await db.select({ id: schema.channels.id, name: schema.channels.name })
      .from(schema.channels)
      .where(eq(schema.channels.type, "avito"));
    return c.json({ from, to, days, avitoAccounts }, 200);
  })

  .put("/daily-report/overrides", requireAdmin, async (c) => {
    const body = await c.req.json<{
      reportDate?: string;
      metric?: string;
      dimensionKey?: string | null;
      value?: number;
      note?: string;
    }>();
    if (!body.reportDate || !body.metric || body.value === undefined || Number.isNaN(Number(body.value))) {
      return c.json({ error: "Укажите reportDate, metric и value" }, 400);
    }
    const row = await upsertDailyOverride({
      reportDate: body.reportDate,
      metric: body.metric,
      dimensionKey: body.dimensionKey ?? null,
      value: Number(body.value),
      note: body.note,
      userId: c.get("userId") as number,
    });
    return c.json({ override: row }, 200);
  })

  .delete("/daily-report/overrides/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Некорректный id" }, 400);
    await deleteDailyOverride(id);
    return c.json({ ok: true }, 200);
  });
