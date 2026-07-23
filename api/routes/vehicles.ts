import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { decodeVin } from "../lib/vin-decode";
import {
  buildVehicleCatalog, filterCatalog, findByPlate, sortByPlatePriority,
} from "../lib/vehicle-catalog";
import { ocrImageBuffer, getPreferredOcrEngine } from "../lib/ocr-buffer";
import { parseStsText } from "../lib/sts-parse";
import { formatPlateDisplay } from "../lib/plate-normalize";
import { getClientInTenant } from "../lib/tenant-guard";
import { getVinPartsHistory, isValidVinParam } from "../lib/vin-parts-history";
import { jsonApiError } from "../lib/api-error";

/** Поля PATCH: clientId/id/tenant — только через создание или смену клиента отдельно. */
const VEHICLE_PATCH_KEYS = [
  "vin", "plate", "make", "model", "year", "mileage", "engine", "notes",
] as const;

function pickVehiclePatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};
  for (const key of VEHICLE_PATCH_KEYS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (typeof patch.vin === "string") patch.vin = patch.vin.toUpperCase();
  return patch;
}

export const vehicles = new Hono()
  .use("*", requireAuth)

  .get("/catalog", async (c) => {
    const qRaw = (c.req.query("q") || "").trim();
    const plateParam = (c.req.query("plate") || "").trim();
    const clientIdRaw = c.req.query("clientId");
    const clientId = clientIdRaw ? parseInt(clientIdRaw, 10) : null;
    const limit = Math.min(100, Math.max(10, parseInt(c.req.query("limit") || "50", 10) || 50));

    const all = await buildVehicleCatalog();
    let filtered = filterCatalog(all, { q: qRaw, clientId, plate: plateParam });
    if (plateParam) filtered = sortByPlatePriority(filtered, plateParam);

    return c.json({ vehicles: filtered.slice(0, limit), total: filtered.length }, 200);
  })

  .get("/by-plate", async (c) => {
    const plate = (c.req.query("plate") || "").trim();
    if (!plate) return c.json({ error: "Укажите госномер" }, 400);
    const result = await findByPlate(plate);
    return c.json({
      ...result,
      displayPlate: formatPlateDisplay(result.normalizedPlate || plate),
    }, 200);
  })

  .post("/recognize-sts", async (c) => {
    const body = await c.req.parseBody();
    const front = body.front ?? body.frontSide;
    const back = body.back ?? body.backSide;

    if ((!front || typeof front === "string") && (!back || typeof back === "string")) {
      return c.json({ error: "Загрузите фото СТС (лицевая и/или оборотная сторона)" }, 400);
    }

    let ocrText = "";
    let ocrEngine: "yandex" | "tesseract" = getPreferredOcrEngine() || "tesseract";
    try {
      if (front && typeof front !== "string") {
        const f = front as File;
        const buf = Buffer.from(await f.arrayBuffer());
        const res = await ocrImageBuffer(buf, f.type);
        ocrText += res.text;
        ocrEngine = res.engine;
      }
      if (back && typeof back !== "string") {
        const f = back as File;
        const buf = Buffer.from(await f.arrayBuffer());
        const res = await ocrImageBuffer(buf, f.type);
        if (ocrText) ocrText += "\n\n";
        ocrText += res.text;
        if (res.engine === "tesseract") ocrEngine = "tesseract";
      }
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка распознавания", 500, "vehicles_ocr");
    }

    if (!ocrText.trim()) {
      return c.json({ error: "Не удалось прочитать текст с фото. Сделайте снимок чётче, без бликов." }, 422);
    }

    const parsed = parseStsText(ocrText);
    let lookup = null;
    if (parsed.plate) {
      lookup = await findByPlate(parsed.plate);
    }

    return c.json({
      parsed,
      ocrPreview: ocrText.slice(0, 800),
      ocrEngine,
      lookup,
      displayPlate: parsed.plate ? formatPlateDisplay(parsed.plate) : null,
    }, 200);
  })

  .get("/decode-vin", async (c) => {
    const vin = c.req.query("vin") || "";
    const result = await decodeVin(vin);
    if ("error" in result) return c.json({ error: result.error }, 400);
    try {
      const { logQuotaUsage } = await import("../lib/quota-enforcement");
      const { tenantId } = await import("../lib/tenant-query");
      await logQuotaUsage(tenantId(), "vin_decodes", 1);
    } catch (e) {
      console.warn("[quota] vin_decodes log failed:", (e as Error)?.message || e);
    }
    return c.json({ vehicle: result }, 200);
  })

  .get("/:vin/parts-history", async (c) => {
    const vin = c.req.param("vin") || "";
    if (!isValidVinParam(vin)) {
      return c.json({ vin: vin.trim().toUpperCase(), items: [], recommendations: [] }, 200);
    }
    const result = await getVinPartsHistory(vin);
    return c.json(result, 200);
  })

  .get("/client/:clientId/all", async (c) => {
    const clientId = parseInt(c.req.param("clientId"));
    if (Number.isNaN(clientId)) return c.json({ error: "Неверный clientId" }, 400);
    const client = await getClientInTenant(clientId);
    if (!client) return c.json({ error: "Клиент не найден" }, 404);

    const garage = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, clientId));

    const serviceDeals = await db.select().from(schema.deals)
      .where(and(eq(schema.deals.clientId, clientId), eq(schema.deals.orderType, "service")))
      .orderBy(desc(schema.deals.updatedAt));

    const garageIds = new Set(garage.map((v) => v.id));
    const seenKeys = new Set(
      garage.map((v) => `${(v.vin || "").toLowerCase()}|${(v.plate || "").toLowerCase()}`),
    );

    const fromDeals: Array<{
      id: string;
      source: "deal";
      dealId: number;
      vin: string | null;
      plate: string | null;
      make: string | null;
      model: string | null;
      year: number | null;
      mileage: number | null;
    }> = [];

    for (const d of serviceDeals) {
      if (d.vehicleId && garageIds.has(d.vehicleId)) continue;
      const hasCar = d.vehicleMake || d.vehicleModel || d.vin || d.vehiclePlate;
      if (!hasCar) continue;
      const key = `${(d.vin || "").toLowerCase()}|${(d.vehiclePlate || "").toLowerCase()}`;
      if (key !== "|" && seenKeys.has(key)) continue;
      if (key !== "|") seenKeys.add(key);
      fromDeals.push({
        id: `deal-${d.id}`,
        source: "deal",
        dealId: d.id,
        vin: d.vin,
        plate: d.vehiclePlate,
        make: d.vehicleMake,
        model: d.vehicleModel,
        year: d.vehicleYear,
        mileage: d.mileage,
      });
    }

    let maxMileage: number | null = null;
    for (const v of garage) {
      if (v.mileage != null) maxMileage = maxMileage == null ? v.mileage : Math.max(maxMileage, v.mileage);
    }
    for (const d of serviceDeals) {
      if (d.mileage != null) maxMileage = maxMileage == null ? d.mileage : Math.max(maxMileage, d.mileage);
    }

    const vehicles = [
      ...garage.map((v) => ({ ...v, source: "garage" as const })),
      ...fromDeals,
    ];

    return c.json({ vehicles, maxMileage }, 200);
  })

  .get("/client/:clientId", async (c) => {
    const clientId = parseInt(c.req.param("clientId"));
    const client = await getClientInTenant(clientId);
    if (!client) return c.json({ error: "Клиент не найден" }, 404);
    const list = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, clientId));
    return c.json({ vehicles: list }, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const clientId = Number(body.clientId);
    const client = await getClientInTenant(clientId);
    if (!client) return c.json({ error: "Клиент не найден" }, 404);
    const [vehicle] = await db.insert(schema.vehicles).values({
      clientId,
      vin: body.vin?.toUpperCase(),
      plate: body.plate,
      make: body.make,
      model: body.model,
      year: body.year,
      mileage: body.mileage,
      engine: body.engine,
      notes: body.notes,
    }).returning();
    return c.json({ vehicle }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json() as Record<string, unknown>;
    const [current] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id));
    if (!current) return c.json({ error: "Автомобиль не найден" }, 404);
    const client = await getClientInTenant(current.clientId);
    if (!client) return c.json({ error: "Автомобиль не найден" }, 404);
    const patch = pickVehiclePatch(body);
    if (Object.keys(patch).length === 0) {
      return c.json({ vehicle: current }, 200);
    }
    const [vehicle] = await db.update(schema.vehicles).set(patch).where(eq(schema.vehicles.id, id)).returning();
    return c.json({ vehicle }, 200);
  })
  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const [current] = await db.select().from(schema.vehicles).where(eq(schema.vehicles.id, id));
    if (!current) return c.json({ error: "Автомобиль не найден" }, 404);
    const client = await getClientInTenant(current.clientId);
    if (!client) return c.json({ error: "Автомобиль не найден" }, 404);
    await db.delete(schema.vehicles).where(eq(schema.vehicles.id, id));
    return c.json({ ok: true }, 200);
  });
