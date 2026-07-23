import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import {
  calcLaborLinePrice,
  getDefaultLaborRate,
  recalcDealTotals,
} from "../lib/deal-totals";
import { searchLaborCatalog, STO_LABOR_CATALOG } from "../lib/sto-labor-catalog";
import { enrichOrderItems } from "../lib/sto-items";
import { sqlGet, sqlRun } from "../database/raw-sql";
import { logDealAudit } from "../lib/sto-audit";
import { assertDealInTenant } from "../lib/tenant-guard";
import { tenantId } from "../lib/tenant-query";
import { getDefaultLaborPayrollPercent } from "../lib/labor-payroll";

export const orders = new Hono()
  .use("*", requireAuth)

  .get("/labor-catalog", async (c) => {
    const q = c.req.query("q") || "";
    return c.json({ items: await searchLaborCatalog(q) }, 200);
  })

  .use("/:id{[0-9]+}/*", async (c, next) => {
    const dealId = parseInt(c.req.param("id"), 10);
    const check = await assertDealInTenant(dealId);
    if (!check.ok) return c.json({ error: "Заказ не найден" }, 404);
    await next();
  })

  .get("/:id{[0-9]+}/items", async (c) => {
    const dealId = parseInt(c.req.param("id"));
    const items = await enrichOrderItems(await db.select().from(schema.orderItems).where(eq(schema.orderItems.dealId, dealId)));
    return c.json({ items }, 200);
  })

  .get("/:id{[0-9]+}/labor", async (c) => {
    const dealId = parseInt(c.req.param("id"));
    const items = await db.select().from(schema.dealLaborItems)
      .where(eq(schema.dealLaborItems.dealId, dealId))
      .orderBy(schema.dealLaborItems.sortOrder, schema.dealLaborItems.id);
    return c.json({ items }, 200);
  })

  .post("/:id{[0-9]+}/items", async (c) => {
    const dealId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const user = c.get("user") as { id: number };
    const [item] = await db.insert(schema.orderItems).values({
      dealId,
      article: body.article,
      brand: body.brand,
      name: body.name || "Позиция",
      qty: body.qty ?? 1,
      price: body.price,
      isOriginal: body.isOriginal ?? false,
      inStock: body.inStock ?? true,
      partSource: body.partSource || "stock",
    }).returning();
    if (body.laborItemId != null || body.embeddedInLabor || body.stockPartId != null) {
      await sqlRun(`
        UPDATE order_items SET
          labor_item_id = COALESCE(?, labor_item_id),
          embedded_in_labor = COALESCE(?, embedded_in_labor),
          stock_part_id = COALESCE(?, stock_part_id)
        WHERE id = ?
      `,
        body.laborItemId ?? null,
        body.embeddedInLabor ? 1 : 0,
        body.stockPartId ?? null,
        item.id,
      );
    }
    await recalcDealTotals(dealId);
    await logDealAudit(dealId, user?.id, "part_added", item.name);
    return c.json({ item }, 201);
  })

  .patch("/items/:itemId", async (c) => {
    const itemId = parseInt(c.req.param("itemId"));
    const body = await c.req.json();
    const user = c.get("user") as { id: number };
    const [existing] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId));
    if (!existing) return c.json({ error: "Not found" }, 404);
    const dealCheck = await assertDealInTenant(existing.dealId);
    if (!dealCheck.ok) return c.json({ error: "Not found" }, 404);

    const patch: Record<string, unknown> = {};
    for (const key of ["article", "brand", "name", "qty", "price", "isOriginal", "inStock", "partSource"] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    const [item] = await db.update(schema.orderItems).set(patch).where(eq(schema.orderItems.id, itemId)).returning();
    if (body.laborItemId !== undefined || body.embeddedInLabor !== undefined || body.stockPartId !== undefined) {
      const row = await sqlGet<{ labor_item_id: number; embedded_in_labor: number; stock_part_id: number }>(
        "SELECT labor_item_id, embedded_in_labor, stock_part_id FROM order_items WHERE id=?",
        itemId,
      );
      await sqlRun(`
        UPDATE order_items SET labor_item_id = ?, embedded_in_labor = ?, stock_part_id = ? WHERE id = ?
      `,
        body.laborItemId !== undefined ? body.laborItemId : row?.labor_item_id ?? null,
        body.embeddedInLabor !== undefined ? (body.embeddedInLabor ? 1 : 0) : row?.embedded_in_labor ?? 0,
        body.stockPartId !== undefined ? body.stockPartId : row?.stock_part_id ?? null,
        itemId,
      );
    }
    await recalcDealTotals(existing.dealId);
    await logDealAudit(existing.dealId, user?.id, "part_updated", existing.name);
    return c.json({ item }, 200);
  })

  .delete("/items/:itemId", async (c) => {
    const itemId = parseInt(c.req.param("itemId"));
    const [item] = await db.select().from(schema.orderItems).where(eq(schema.orderItems.id, itemId));
    if (!item) return c.json({ error: "Not found" }, 404);
    const dealCheck = await assertDealInTenant(item.dealId);
    if (!dealCheck.ok) return c.json({ error: "Not found" }, 404);
    await db.delete(schema.orderItems).where(eq(schema.orderItems.id, itemId));
    await recalcDealTotals(item.dealId);
    return c.json({ ok: true }, 200);
  })

  .post("/:id{[0-9]+}/labor", async (c) => {
    const dealId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const defaultRate = await getDefaultLaborRate();

    let name = (body.name || "").trim();
    let normHours = Number(body.normHours) || 1;
    let code = body.code || null;

    if (body.catalogCode) {
      const tid = tenantId();
      const catRow = await sqlGet<{ code: string; name: string; norm_hours: number }>(
        "SELECT code, name, norm_hours FROM sto_labor_catalog WHERE code = ? AND is_active = 1 AND (tenant_id = ? OR tenant_id IS NULL)",
        body.catalogCode,
        tid,
      );
      const cat = catRow
        ? { code: catRow.code, name: catRow.name, normHours: catRow.norm_hours }
        : STO_LABOR_CATALOG.find((i) => i.code === body.catalogCode);
      if (cat) {
        name = cat.name;
        normHours = cat.normHours;
        code = cat.code;
      }
    }
    if (!name) return c.json({ error: "Укажите название работы" }, 400);

    const hours = body.hours != null ? Number(body.hours) : normHours;
    let hourlyRate = body.hourlyRate != null ? Number(body.hourlyRate) : defaultRate;
    let price = calcLaborLinePrice({ normHours, hours, hourlyRate }, defaultRate);
    if (body.price != null && !Number.isNaN(Number(body.price))) {
      price = Math.round(Number(body.price) * 100) / 100;
      if (hours > 0) hourlyRate = Math.round((price / hours) * 100) / 100;
    }

    let executorUserId = body.executorUserId != null ? Number(body.executorUserId) : null;
    let executorName = body.executorName || null;
    if (executorUserId && !executorName) {
      const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, executorUserId));
      executorName = u?.name ?? null;
    }

    let payrollPercent = body.payrollPercent != null ? Number(body.payrollPercent) : null;
    if (executorUserId && (payrollPercent == null || Number.isNaN(payrollPercent))) {
      payrollPercent = await getDefaultLaborPayrollPercent(executorUserId);
    }

    const [item] = await db.insert(schema.dealLaborItems).values({
      dealId,
      code,
      name,
      normHours,
      hours,
      hourlyRate,
      price,
      executorName,
      executorUserId,
      payrollPercent,
      sortOrder: body.sortOrder ?? 0,
    }).returning();
    await recalcDealTotals(dealId);
    return c.json({ item }, 201);
  })

  .patch("/labor/:itemId", async (c) => {
    const itemId = parseInt(c.req.param("itemId"));
    const body = await c.req.json();
    const [existing] = await db.select().from(schema.dealLaborItems).where(eq(schema.dealLaborItems.id, itemId));
    if (!existing) return c.json({ error: "Not found" }, 404);
    const dealCheck = await assertDealInTenant(existing.dealId);
    if (!dealCheck.ok) return c.json({ error: "Not found" }, 404);

    const defaultRate = await getDefaultLaborRate();
    const normHours = body.normHours != null ? Number(body.normHours) : existing.normHours ?? 1;
    const hours = body.hours != null ? Number(body.hours) : existing.hours ?? normHours;
    const hourlyRate = body.hourlyRate != null ? Number(body.hourlyRate) : existing.hourlyRate ?? defaultRate;

    const patch: Record<string, unknown> = {};
    for (const key of ["code", "name", "executorName", "sortOrder"] as const) {
      if (body[key] !== undefined) patch[key] = body[key];
    }
    if (body.executorUserId !== undefined) {
      const uid = body.executorUserId ? Number(body.executorUserId) : null;
      patch.executorUserId = uid;
      if (uid) {
        const [u] = await db.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, uid));
        patch.executorName = u?.name ?? existing.executorName;
        if (body.payrollPercent === undefined && !existing.payrollPercent) {
          patch.payrollPercent = await getDefaultLaborPayrollPercent(uid);
        }
      } else {
        patch.executorName = body.executorName ?? null;
      }
    }
    if (body.payrollPercent !== undefined) {
      patch.payrollPercent = body.payrollPercent != null ? Number(body.payrollPercent) : null;
    }
    patch.normHours = normHours;
    patch.hours = hours;
    patch.hourlyRate = hourlyRate;
    patch.price = calcLaborLinePrice({ normHours, hours, hourlyRate }, defaultRate);

    const [item] = await db.update(schema.dealLaborItems).set(patch).where(eq(schema.dealLaborItems.id, itemId)).returning();
    await recalcDealTotals(existing.dealId);
    return c.json({ item }, 200);
  })

  .delete("/labor/:itemId", async (c) => {
    const itemId = parseInt(c.req.param("itemId"));
    const [item] = await db.select().from(schema.dealLaborItems).where(eq(schema.dealLaborItems.id, itemId));
    if (!item) return c.json({ error: "Not found" }, 404);
    const dealCheck = await assertDealInTenant(item.dealId);
    if (!dealCheck.ok) return c.json({ error: "Not found" }, 404);
    await db.delete(schema.dealLaborItems).where(eq(schema.dealLaborItems.id, itemId));
    await recalcDealTotals(item.dealId);
    return c.json({ ok: true }, 200);
  });
