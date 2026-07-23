import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, inArray, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { trackActivityEvent } from "../lib/activity-track";
import {
  WO_STAGES,
  enrichServiceDeals,
  filterByDate,
  filterBySearchScope,
} from "../lib/work-order-list";
import { enrichOrderItems } from "../lib/sto-items";
import { filterByDemoClients, isDemoUser, assertDemoClientAccess } from "../lib/demo-mode";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getClientInTenant, getTagInTenant } from "../lib/tenant-guard";
import { jsonApiError } from "../lib/api-error";
import { sendToClientPreferred } from "../lib/client-notify";

/** Поля, которые можно менять через PATCH. tenantId / оплата — только через close-with-payment. */
const DEAL_PATCH_KEYS = [
  "clientId", "vehicleId", "title", "orderType", "status",
  "amount", "partsCost", "laborCost", "discountAmount",
  "description", "vin", "vehicleMake", "vehicleModel", "vehicleYear", "vehiclePlate", "mileage",
  "avitoItemId", "avitoItemTitle", "avitoPrice", "avitoOrderId",
  "deliveryMethod",
  "cdekOrderUuid", "cdekTrackNumber", "cdekPvzCode", "cdekPvzAddress", "cdekCityCode",
  "cdekTariffCode", "cdekStatus", "cdekDeliveryCost", "cdekImNumber", "cdekProductName",
  "cdekPackageWeight", "cdekPackageLength", "cdekPackageWidth", "cdekPackageHeight",
  "cdekGoodsPayment", "cdekDeliveryRecipient", "cdekErrorMessage",
  "assignedTo", "vehicleValue", "clientIsPayer", "woGroup", "campaign", "appointmentId",
  "woNote", "warrantyObligations", "contractTerms", "inspectionReport", "clientApprovalStatus",
  "defectPhotos", "woEnterpriseId", "companyName",
] as const;

function pickDealPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of DEAL_PATCH_KEYS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  return patch;
}

export const deals = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const orderType = c.req.query("orderType");
    const status = c.req.query("status");
    const stage = c.req.query("stage");
    const assignedToRaw = c.req.query("assignedTo");
    const assignedTo = assignedToRaw ? parseInt(assignedToRaw, 10) : null;
    const tagIdRaw = c.req.query("tagId");
    const tagId = tagIdRaw ? parseInt(tagIdRaw, 10) : null;
    const hasDebt = c.req.query("hasDebt") === "1";
    const dateFrom = c.req.query("dateFrom") || "";
    const dateTo = c.req.query("dateTo") || "";
    const searchScope = c.req.query("searchScope") || "all";
    const search = (c.req.query("search") || "").trim().toLowerCase();
    const clientIdRaw = c.req.query("clientId");
    const clientId = clientIdRaw ? parseInt(clientIdRaw, 10) : null;

    const rows = await db
      .select({ deal: schema.deals, client: schema.clients })
      .from(schema.deals)
      .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id))
      .where(forTenant(schema.deals))
      .orderBy(desc(schema.deals.updatedAt));

    let all = rows.map(({ deal, client }) => ({
      ...deal,
      clientName: client.name,
      clientPhone: client.phone,
    }));

    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      all = await filterByDemoClients(user, all);
    }

    if (orderType) all = all.filter((d) => d.orderType === orderType);
    if (status) all = all.filter((d) => d.status === status);
    if (stage) {
      const stageDef = WO_STAGES.find((s) => s.id === stage);
      if (stageDef) all = all.filter((d) => stageDef.statuses.includes(d.status as never));
    }
    if (assignedTo && !Number.isNaN(assignedTo)) {
      all = all.filter((d) => d.assignedTo === assignedTo);
    }
    if (clientId && !Number.isNaN(clientId)) {
      all = all.filter((d) => d.clientId === clientId);
    }
    if (tagId && !Number.isNaN(tagId)) {
      const tag = await getTagInTenant(tagId);
      if (!tag) {
        return c.json({ deals: [] }, 200);
      }
      const tagged = await db.select({ clientId: schema.clientTags.clientId })
        .from(schema.clientTags).where(eq(schema.clientTags.tagId, tagId));
      const clientSet = new Set(tagged.map((t) => t.clientId));
      all = all.filter((d) => clientSet.has(d.clientId));
    }
    all = filterByDate(all, dateFrom || undefined, dateTo || undefined);
    if (search) all = filterBySearchScope(all, search, searchScope);

    if (orderType === "service") {
      let enriched = await enrichServiceDeals(all);
      if (hasDebt) enriched = enriched.filter((d) => d.hasDebt);
      return c.json({ deals: enriched }, 200);
    }

    return c.json({ deals: all }, 200);
  })
  .get("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);

    const [deal] = await db.select().from(schema.deals)
      .where(withTenant(schema.deals, eq(schema.deals.id, id)));
    if (!deal) return c.json({ error: "Заказ не найден" }, 404);

    const user = c.get("user") as { role?: string };
    if (!(await assertDemoClientAccess(user, deal.clientId))) return c.json({ error: "Заказ не найден" }, 404);

    const client = await getClientInTenant(deal.clientId);
    if (!client) return c.json({ error: "Заказ не найден" }, 404);
    const items = await enrichOrderItems(await db.select().from(schema.orderItems).where(eq(schema.orderItems.dealId, id)));
    const laborItems = await db.select().from(schema.dealLaborItems)
      .where(eq(schema.dealLaborItems.dealId, id))
      .orderBy(schema.dealLaborItems.sortOrder, schema.dealLaborItems.id);
    const convs = await db.select().from(schema.conversations).where(eq(schema.conversations.clientId, deal.clientId));
    const conversation = convs.sort((a, b) =>
      (b.lastMessageAt?.getTime() || 0) - (a.lastMessageAt?.getTime() || 0),
    )[0] ?? null;

    let assignee = null;
    if (deal.assignedTo) {
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, deal.assignedTo));
      if (user) assignee = { id: user.id, name: user.name };
    }

    const clientTagRows = await db
      .select({ tag: schema.tags })
      .from(schema.clientTags)
      .innerJoin(schema.tags, eq(schema.clientTags.tagId, schema.tags.id))
      .where(eq(schema.clientTags.clientId, deal.clientId));
    const clientTags = clientTagRows.map((r) => ({ id: r.tag.id, name: r.tag.name, color: r.tag.color }));

    return c.json({ deal, client, items, laborItems, conversationId: conversation?.id ?? null, assignee, clientTags }, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const clientId = Number(body.clientId);
    const title = (body.title || "").trim();

    if (!clientId || Number.isNaN(clientId)) {
      return c.json({ error: "Укажите клиента (clientId)" }, 400);
    }
    if (!title) {
      return c.json({ error: "Укажите название заказа" }, 400);
    }

    const client = await getClientInTenant(clientId);
    if (!client) return c.json({ error: "Клиент не найден" }, 404);

    let amount = body.amount;
    if (amount != null && (Number.isNaN(Number(amount)) || amount === "")) amount = null;

    try {
      const [deal] = await db.insert(schema.deals).values({
        clientId,
        title,
        orderType: body.orderType || "parts",
        status: body.status || "new",
        amount: amount != null ? Number(amount) : null,
        partsCost: body.partsCost,
        laborCost: body.laborCost,
        vin: body.vin || null,
        vehicleId: body.vehicleId,
        mileage: body.mileage != null ? Number(body.mileage) : null,
        description: body.description,
        deliveryMethod: body.deliveryMethod,
        assignedTo: body.assignedTo || c.get("userId"),
        avitoItemId: body.avitoItemId || null,
        avitoItemTitle: body.avitoItemTitle || null,
        avitoPrice: body.avitoPrice != null ? Number(body.avitoPrice) : null,
        tenantId: tenantId(),
      }).returning();
      void trackActivityEvent(c.get("userId") as number, "deal_created", "deal", deal.id, { title: deal.title });
      return c.json({ deal }, 201);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка БД", 500, "deals_db");
    }
  })
  .post("/bulk-delete", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const raw = body.ids;
    const ids = Array.isArray(raw)
      ? [...new Set(raw.map((v: unknown) => Number(v)).filter((n) => Number.isInteger(n) && n > 0))]
      : [];
    if (ids.length === 0) return c.json({ error: "Укажите список id заказов" }, 400);

    await db.delete(schema.deals).where(and(inArray(schema.deals.id, ids), forTenant(schema.deals)));
    return c.json({ ok: true, deleted: ids.length }, 200);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json() as Record<string, unknown>;
    const patch = pickDealPatch(body);

    const [prev] = await db.select().from(schema.deals)
      .where(withTenant(schema.deals, eq(schema.deals.id, id)));

    const [deal] = await db.update(schema.deals)
      .set(patch)
      .where(withTenant(schema.deals, eq(schema.deals.id, id)))
      .returning();

    if (deal && patch.status && (patch.status === "done" || patch.status === "cancelled")) {
      const apptStatus = patch.status === "cancelled" ? "cancelled" : "done";
      await db.update(schema.serviceAppointments)
        .set({ status: apptStatus, updatedAt: new Date() })
        .where(eq(schema.serviceAppointments.dealId, id));
    }

    let notify: { ok: boolean; channel?: string; error?: string } | null = null;
    if (
      deal
      && patch.status === "ready"
      && prev?.status !== "ready"
      && (deal.orderType === "service" || prev?.orderType === "service")
    ) {
      const title = deal.title || `ЗН-${deal.id}`;
      const text = `Ваш автомобиль готов к выдаче. ${title}. Ждём вас в сервисе!`;
      try {
        notify = await sendToClientPreferred({
          clientId: deal.clientId,
          text,
          preferredMessenger: "auto",
          senderId: c.get("userId") as number,
        });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "Ошибка уведомления";
        notify = { ok: false, error: msg };
      }
    }

    return c.json({ deal, notify }, 200);
  })
  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);

    const [deal] = await db.select().from(schema.deals)
      .where(withTenant(schema.deals, eq(schema.deals.id, id)));
    if (!deal) return c.json({ error: "Заказ не найден" }, 404);

    await db.delete(schema.deals).where(withTenant(schema.deals, eq(schema.deals.id, id)));
    return c.json({ ok: true }, 200);
  });
