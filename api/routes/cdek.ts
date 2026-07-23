import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, or, isNotNull, inArray, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import {
  getCdekSettings,
  isCdekConfigured,
  isCdekEnabled,
  isCdekTestMode,
  resolveShipmentPoint,
  resolveFromCityCode,
  searchCities,
  listPvz,
  calculateTariffs,
  calculateTariffPrice,
  createCdekOrder,
  getCdekOrderByUuid,
  getCdekOrderByNumber,
  getCdekOrderFull,
  extractCdekOrderErrors,
  releaseCdekOrderForRecreate,
  isCdekImNumberConflict,
  localizeCdekImNumberConflict,
  localizeCdekError,
} from "../lib/cdek";
import { notifyCdekArrivalIfNeeded } from "../services/cdek-poll";
import {
  cdekShipmentPhase,
  cdekPhaseLabel,
  cdekStatusDisplayLabel,
  cdekTrackingUrl,
  pickLatestCdekStatus,
  cdekIsErrorStatus,
} from "../lib/cdek-status";
import { forTenant, withTenant } from "../lib/tenant-query";
import { getDealInTenant } from "../lib/tenant-guard";

async function refreshDealCdekTrack(
  deal: typeof schema.deals.$inferSelect,
  settings: Awaited<ReturnType<typeof getCdekSettings>>,
) {
  let entity = null;
  let requestErrors: string[] = [];
  if (deal.cdekOrderUuid) {
    const full = await getCdekOrderFull(settings, deal.cdekOrderUuid).catch(() => null);
    entity = full?.entity || null;
    requestErrors = extractCdekOrderErrors(full);
  }
  if (!entity) {
    entity = await getCdekOrderByNumber(settings, deal.cdekImNumber || deal.title || "").catch(() => null);
  }
  if (!entity) {
    return {
      trackNumber: deal.cdekTrackNumber,
      status: deal.cdekStatus,
      errorMessage: deal.cdekErrorMessage,
      statuses: [] as unknown[],
    };
  }

  const trackNumber = entity.cdek_number || deal.cdekTrackNumber;
  const latest = pickLatestCdekStatus(entity.statuses);
  const status = latest?.raw || deal.cdekStatus;
  const errorMessage = requestErrors.length
    ? requestErrors.map((e) => localizeCdekError(e, deal.cdekImNumber || deal.title || "")).join(". ")
    : (cdekIsErrorStatus(status) ? deal.cdekErrorMessage : null);

  if (trackNumber !== deal.cdekTrackNumber || status !== deal.cdekStatus || errorMessage !== deal.cdekErrorMessage) {
    await db.update(schema.deals).set({
      cdekTrackNumber: trackNumber,
      cdekStatus: status,
      cdekOrderUuid: entity.uuid || deal.cdekOrderUuid,
      cdekErrorMessage: errorMessage,
      updatedAt: new Date(),
    }).where(eq(schema.deals.id, deal.id));
  }

  await notifyCdekArrivalIfNeeded({ ...deal, cdekTrackNumber: trackNumber || deal.cdekTrackNumber, cdekStatus: status }, status);

  return { trackNumber, status, errorMessage, statuses: entity.statuses || [], uuid: entity.uuid };
}

function maskSecret(s?: string | null) {
  if (!s) return null;
  if (s.length <= 8) return "••••••••";
  return s.slice(0, 4) + "••••" + s.slice(-4);
}

export const cdek = new Hono()
  .use("*", requireAuth)
  .get("/status", async (c) => {
    const settings = await getCdekSettings();
    return c.json({
      configured: isCdekConfigured(settings),
      enabled: isCdekEnabled(settings),
      testMode: isCdekTestMode(settings),
      hasShipmentPoint: Boolean(resolveShipmentPoint(settings)),
      fromCityCode: resolveFromCityCode(settings),
      fromEnv: Boolean(process.env.CDEK_CLIENT_ID && process.env.CDEK_CLIENT_SECRET),
    }, 200);
  })
  .get("/settings", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);

    const settings = await getCdekSettings();
    return c.json({
      settings: {
        ...settings,
        clientSecret: maskSecret(settings.clientSecret),
      },
    }, 200);
  })
  .patch("/settings", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);

    const body = await c.req.json();
    const current = await getCdekSettings();

    const [updated] = await db.update(schema.cdekSettings).set({
      enabled: body.enabled ?? current.enabled,
      testMode: body.testMode ?? current.testMode,
      clientId: body.clientId ?? current.clientId,
      clientSecret: body.clientSecret && !String(body.clientSecret).includes("••••")
        ? body.clientSecret : current.clientSecret,
      shipmentPoint: body.shipmentPoint ?? current.shipmentPoint,
      fromCityCode: body.fromCityCode != null ? Number(body.fromCityCode) : current.fromCityCode,
      senderName: body.senderName ?? current.senderName,
      senderPhone: body.senderPhone ?? current.senderPhone,
      defaultTariffCode: body.defaultTariffCode != null ? Number(body.defaultTariffCode) : current.defaultTariffCode,
      updatedAt: new Date(),
    }).where(withTenant(schema.cdekSettings, eq(schema.cdekSettings.id, current.id))).returning();

    return c.json({ settings: { ...updated, clientSecret: maskSecret(updated.clientSecret) } }, 200);
  })
  .get("/cities", async (c) => {
    const q = c.req.query("q") || "";
    if (q.length < 2) return c.json({ cities: [] }, 200);
    const settings = await getCdekSettings();
    if (!isCdekConfigured(settings)) return c.json({ error: "СДЭК не настроен" }, 400);
    const cities = await searchCities(settings, q);
    return c.json({ cities }, 200);
  })
  .get("/pvz", async (c) => {
    const cityCode = parseInt(c.req.query("cityCode") || "");
    if (!cityCode) return c.json({ error: "Укажите cityCode" }, 400);
    const q = c.req.query("q") || "";
    const settings = await getCdekSettings();
    if (!isCdekConfigured(settings)) return c.json({ error: "СДЭК не настроен" }, 400);
    const pvz = await listPvz(settings, cityCode, q || undefined);
    return c.json({ pvz, total: pvz.length }, 200);
  })
  .post("/calculate", async (c) => {
    const body = await c.req.json();
    const settings = await getCdekSettings();
    if (!isCdekConfigured(settings)) return c.json({ error: "СДЭК не настроен" }, 400);

    const fromCityCode = body.fromCityCode || resolveFromCityCode(settings);
    const toCityCode = body.toCityCode;
    if (!fromCityCode || !toCityCode) return c.json({ error: "Укажите города отправления и получения" }, 400);

    const tariffs = await calculateTariffs(settings, {
      fromCityCode,
      toCityCode,
      weight: body.weight || 1000,
      length: body.length,
      width: body.width,
      height: body.height,
    });

    let deliverySum: number | undefined;
    if (body.tariffCode) {
      deliverySum = await calculateTariffPrice(settings, {
        fromCityCode,
        toCityCode,
        tariffCode: Number(body.tariffCode),
        weight: body.weight || 1000,
        length: body.length,
        width: body.width,
        height: body.height,
      });
    }

    return c.json({ tariffs, deliverySum, fromCityCode }, 200);
  })
  .post("/deals/:dealId/ship", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const body = await c.req.json();
    const settings = await getCdekSettings();
    if (!isCdekConfigured(settings)) return c.json({ error: "СДЭК не настроен — Настройки → СДЭК" }, 400);

    const deal = await getDealInTenant(dealId);
    if (!deal) return c.json({ error: "Заказ не найден" }, 404);

    const [client] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, deal.clientId)));
    if (!client) return c.json({ error: "Клиент не найден" }, 404);

    const items = await db.select().from(schema.orderItems).where(eq(schema.orderItems.dealId, dealId));
    const deliveryPoint = body.deliveryPoint || deal.cdekPvzCode;
    const tariffCode = body.tariffCode || deal.cdekTariffCode || settings.defaultTariffCode || 136;
    const cityCode = body.cityCode || deal.cdekCityCode;

    if (!deliveryPoint) return c.json({ error: "Выберите пункт выдачи СДЭК" }, 400);
    if (!client.phone) return c.json({ error: "У клиента нет телефона — нужен для СДЭК" }, 400);

    const productName = (body.productName || "").trim();
    if (!productName) return c.json({ error: "Укажите наименование товара для СДЭК" }, 400);

    const weightG = Math.round(Number(body.weightGrams) || 0);
    const lengthCm = Math.round(Number(body.lengthCm) || 0);
    const widthCm = Math.round(Number(body.widthCm) || 0);
    const heightCm = Math.round(Number(body.heightCm) || 0);
    if (weightG < 100) return c.json({ error: "Вес должен быть не менее 100 г" }, 400);
    if (!lengthCm || !widthCm || !heightCm) return c.json({ error: "Укажите габариты (длина, ширина, высота) в см" }, 400);

    const imNumber = String(body.imNumber || deal.title || "").trim();
    if (!imNumber) return c.json({ error: "У заказа нет номера — укажите название заказа в CRM" }, 400);

    if (body.replaceOldOrder) {
      await releaseCdekOrderForRecreate(settings, deal);
    }

    const goodsCost = Math.round(Number(body.goodsPayment) || Number(deal.amount) || 0);
    const goodsPaymentFromRecipient = body.goodsPaymentFromRecipient !== false;
    const deliveryFromRecipient = body.deliveryFromRecipient !== false;

    let deliveryBase = Number(body.deliveryBaseCost) || Number(body.deliveryCost) || 0;
    const fromCityCode = resolveFromCityCode(settings);
    if (fromCityCode && cityCode && tariffCode && weightG) {
      try {
        deliveryBase = await calculateTariffPrice(settings, {
          fromCityCode,
          toCityCode: cityCode,
          tariffCode,
          weight: weightG,
          length: lengthCm,
          width: widthCm,
          height: heightCm,
        });
      } catch {
        /* оставляем сумму с клиента */
      }
    }

    const manualRecipient = body.deliveryRecipientManual === true;
    const deliveryRecipientCost = deliveryFromRecipient
      ? (manualRecipient && body.deliveryRecipientCost != null
        ? Math.round(Number(body.deliveryRecipientCost))
        : Math.round(deliveryBase * 2))
      : 0;

    const pkg = {
      weight: weightG,
      length: lengthCm,
      width: widthCm,
      height: heightCm,
      items: [{
        name: productName,
        wareKey: items[0]?.article || `deal-${dealId}`,
        cost: goodsCost,
        weight: weightG,
        qty: 1,
        paymentValue: goodsPaymentFromRecipient ? goodsCost : 0,
      }],
    };

    let result: Awaited<ReturnType<typeof createCdekOrder>>;
    try {
      result = await createCdekOrder(settings, {
        imNumber,
        tariffCode,
        shipmentPoint: resolveShipmentPoint(settings),
        deliveryPoint,
        recipientName: client.name,
        recipientPhone: client.phone,
        goodsPaymentFromRecipient,
        deliveryFromRecipient,
        deliveryRecipientCost: deliveryFromRecipient ? deliveryRecipientCost : 0,
        packages: [pkg],
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isCdekImNumberConflict(msg)) {
        return c.json({ error: localizeCdekImNumberConflict(imNumber) }, 400);
      }
      throw err;
    }

    let trackNumber: string | null = null;
    let cdekStatus: string | null = "CREATED";
    let cdekErrorMessage: string | null = null;

    const pvzAddress = body.pvzAddress || deal.cdekPvzAddress;

    if (result.uuid) {
      await new Promise((r) => setTimeout(r, 2000));
      const full = await getCdekOrderFull(settings, result.uuid).catch(() => null);
      const entity = full?.entity || await getCdekOrderByUuid(settings, result.uuid).catch(() => null)
        || await getCdekOrderByNumber(settings, imNumber).catch(() => null);
      if (entity) {
        trackNumber = entity.cdek_number || null;
        cdekStatus = pickLatestCdekStatus(entity.statuses)?.raw || "CREATED";
      }
      const errors = extractCdekOrderErrors(full).map((e) => localizeCdekError(e, imNumber));
      if (errors.length) {
        cdekErrorMessage = errors.join(". ");
        cdekStatus = pickLatestCdekStatus(full?.entity?.statuses)?.raw || "Некорректный заказ";
        const [updated] = await db.update(schema.deals).set({
          deliveryMethod: "СДЭК",
          cdekOrderUuid: result.uuid,
          cdekTrackNumber: trackNumber,
          cdekPvzCode: deliveryPoint,
          cdekPvzAddress: pvzAddress,
          cdekCityCode: cityCode,
          cdekTariffCode: tariffCode,
          cdekStatus,
          cdekDeliveryCost: deliveryBase || deal.cdekDeliveryCost,
          cdekImNumber: imNumber,
          cdekProductName: productName,
          cdekPackageWeight: weightG,
          cdekPackageLength: lengthCm,
          cdekPackageWidth: widthCm,
          cdekPackageHeight: heightCm,
          cdekGoodsPayment: goodsPaymentFromRecipient ? goodsCost : 0,
          cdekDeliveryRecipient: deliveryFromRecipient ? deliveryRecipientCost : 0,
          cdekErrorMessage,
          updatedAt: new Date(),
        }).where(withTenant(schema.deals, eq(schema.deals.id, dealId))).returning();
        return c.json({ error: cdekErrorMessage, deal: updated, cdek: { uuid: result.uuid, status: cdekStatus } }, 400);
      }
    }

    const [updated] = await db.update(schema.deals).set({
      deliveryMethod: "СДЭК",
      cdekOrderUuid: result.uuid,
      cdekTrackNumber: trackNumber,
      cdekPvzCode: deliveryPoint,
      cdekPvzAddress: pvzAddress,
      cdekCityCode: cityCode,
      cdekTariffCode: tariffCode,
      cdekStatus,
      cdekDeliveryCost: deliveryBase || deal.cdekDeliveryCost,
      cdekImNumber: imNumber,
      cdekProductName: productName,
      cdekPackageWeight: weightG,
      cdekPackageLength: lengthCm,
      cdekPackageWidth: widthCm,
      cdekPackageHeight: heightCm,
      cdekGoodsPayment: goodsPaymentFromRecipient ? goodsCost : 0,
      cdekDeliveryRecipient: deliveryFromRecipient ? deliveryRecipientCost : 0,
      cdekErrorMessage: null,
      status: deal.status === "ready" ? "shipped" : deal.status,
      updatedAt: new Date(),
    }).where(withTenant(schema.deals, eq(schema.deals.id, dealId))).returning();

    return c.json({
      deal: updated,
      cdek: { uuid: result.uuid, trackNumber, status: cdekStatus },
    }, 201);
  })
  .get("/shipments", async (c) => {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const phase = c.req.query("phase") || "";
    const sync = c.req.query("sync") === "1";

    const settings = await getCdekSettings();
    if (sync && isCdekConfigured(settings)) {
      const allDeals = await db.select().from(schema.deals)
        .where(and(forTenant(schema.deals), or(isNotNull(schema.deals.cdekOrderUuid), isNotNull(schema.deals.cdekTrackNumber))))
        .orderBy(desc(schema.deals.updatedAt))
        .limit(40);
      const active = allDeals.filter((d) =>
        d.status !== "done" && d.status !== "cancelled"
        && cdekShipmentPhase(d.cdekStatus) !== "delivered",
      );
      for (const deal of active.slice(0, 20)) {
        try {
          await refreshDealCdekTrack(deal, settings);
          await new Promise((r) => setTimeout(r, 250));
        } catch { /* skip */ }
      }
    }

    const rows = await db
      .select({ deal: schema.deals, client: schema.clients })
      .from(schema.deals)
      .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id))
      .where(and(forTenant(schema.deals), or(isNotNull(schema.deals.cdekOrderUuid), isNotNull(schema.deals.cdekTrackNumber))))
      .orderBy(desc(schema.deals.updatedAt));

    const clientIds = [...new Set(rows.map((r) => r.client.id))];
    const convByClient = new Map<number, number>();
    if (clientIds.length) {
      const convs = await db
        .select()
        .from(schema.conversations)
        .where(and(forTenant(schema.conversations), inArray(schema.conversations.clientId, clientIds)))
        .orderBy(desc(schema.conversations.lastMessageAt));
      for (const conv of convs) {
        if (!convByClient.has(conv.clientId)) convByClient.set(conv.clientId, conv.id);
      }
    }

    let shipments = rows.map(({ deal, client }) => {
      const shipPhase = cdekShipmentPhase(deal.cdekStatus);
      return {
        dealId: deal.id,
        title: deal.title,
        status: deal.status,
        clientId: client.id,
        conversationId: convByClient.get(client.id) ?? null,
        clientName: client.name,
        clientPhone: client.phone,
        cdekOrderUuid: deal.cdekOrderUuid,
        cdekTrackNumber: deal.cdekTrackNumber,
        cdekImNumber: deal.cdekImNumber,
        cdekProductName: deal.cdekProductName,
        cdekPvzCode: deal.cdekPvzCode,
        cdekPvzAddress: deal.cdekPvzAddress,
        cdekStatus: deal.cdekStatus,
        cdekDeliveryCost: deal.cdekDeliveryCost,
        cdekPackageWeight: deal.cdekPackageWeight,
        amount: deal.amount,
        phase: shipPhase,
        phaseLabel: cdekPhaseLabel(shipPhase),
        statusLabel: cdekStatusDisplayLabel(deal.cdekStatus),
        trackingUrl: deal.cdekTrackNumber ? cdekTrackingUrl(deal.cdekTrackNumber) : null,
        updatedAt: deal.updatedAt?.toISOString() ?? null,
        createdAt: deal.createdAt?.toISOString() ?? null,
      };
    });

    if (phase) {
      shipments = phase === "accepted"
        ? shipments.filter((s) => s.phase === "accepted" || s.phase === "created")
        : shipments.filter((s) => s.phase === phase);
    }
    if (q) {
      shipments = shipments.filter((s) =>
        s.clientName.toLowerCase().includes(q)
        || (s.cdekTrackNumber || "").toLowerCase().includes(q)
        || (s.cdekImNumber || "").toLowerCase().includes(q)
        || (s.title || "").toLowerCase().includes(q)
        || (s.cdekProductName || "").toLowerCase().includes(q)
        || (s.cdekPvzAddress || "").toLowerCase().includes(q),
      );
    }

    const counts = {
      total: rows.length,
      accepted: rows.filter((r) => {
        const p = cdekShipmentPhase(r.deal.cdekStatus);
        return p === "accepted" || p === "created";
      }).length,
      in_transit: rows.filter((r) => cdekShipmentPhase(r.deal.cdekStatus) === "in_transit").length,
      at_pvz: rows.filter((r) => cdekShipmentPhase(r.deal.cdekStatus) === "at_pvz").length,
      delivered: rows.filter((r) => cdekShipmentPhase(r.deal.cdekStatus) === "delivered").length,
      created: rows.filter((r) => cdekShipmentPhase(r.deal.cdekStatus) === "created").length,
    };

    return c.json({ shipments, count: shipments.length, counts }, 200);
  })
  .post("/shipments/refresh", async (c) => {
    const settings = await getCdekSettings();
    if (!isCdekConfigured(settings)) return c.json({ error: "СДЭК не настроен" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const dealId = body.dealId ? Number(body.dealId) : null;

    if (dealId) {
      const deal = await getDealInTenant(dealId);
      if (!deal) return c.json({ error: "Заказ не найден" }, 404);
      const result = await refreshDealCdekTrack(deal, settings);
      return c.json({ refreshed: 1, dealId, ...result }, 200);
    }

    const deals = await db.select().from(schema.deals)
      .where(and(forTenant(schema.deals), or(isNotNull(schema.deals.cdekOrderUuid), isNotNull(schema.deals.cdekTrackNumber))))
      .orderBy(desc(schema.deals.updatedAt))
      .limit(30);

    const active = deals.filter((d) => d.status !== "done" && d.status !== "cancelled"
      && cdekShipmentPhase(d.cdekStatus) !== "delivered");

    let refreshed = 0;
    for (const deal of active) {
      try {
        await refreshDealCdekTrack(deal, settings);
        refreshed++;
        await new Promise((r) => setTimeout(r, 300));
      } catch { /* skip */ }
    }

    return c.json({ refreshed, total: active.length }, 200);
  })
  .get("/deals/:dealId/track", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const deal = await getDealInTenant(dealId);
    if (!deal) return c.json({ error: "Заказ не найден" }, 404);

    const settings = await getCdekSettings();
    if (!isCdekConfigured(settings)) return c.json({ error: "СДЭК не настроен" }, 400);

    const result = await refreshDealCdekTrack(deal, settings);
    return c.json(result, 200);
  });
