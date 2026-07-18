import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and, gte, lt } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { trackActivityEvent } from "../lib/activity-track";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";

function parseMonthParam(monthStr: string | undefined): { year: number; month: number } {
  const now = new Date();
  if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  }
  const [y, m] = monthStr.split("-").map(Number);
  return { year: y, month: m };
}

function monthRange(year: number, month: number) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 1);
  return { start, end };
}

export const buyouts = new Hono()
  .use("*", requireAuth)
  .get("/summary", async (c) => {
    const { year, month } = parseMonthParam(c.req.query("month"));
    const { start, end } = monthRange(year, month);

    const rows = await db.select().from(schema.partsBuyouts).where(
      and(
        forTenant(schema.partsBuyouts),
        gte(schema.partsBuyouts.boughtAt, start),
        lt(schema.partsBuyouts.boughtAt, end),
      ),
    );

    const total = rows.reduce((s, r) => s + (r.amount || 0), 0);
    return c.json({
      year,
      month,
      count: rows.length,
      total,
      label: new Date(year, month - 1, 1).toLocaleDateString("ru-RU", { month: "long", year: "numeric" }),
    }, 200);
  })
  .get("/", async (c) => {
    const search = (c.req.query("q") || "").trim().toLowerCase();
    const monthParam = c.req.query("month");
    let all = await db.select().from(schema.partsBuyouts)
      .where(forTenant(schema.partsBuyouts))
      .orderBy(desc(schema.partsBuyouts.boughtAt));

    if (monthParam) {
      const { year, month } = parseMonthParam(monthParam);
      const { start, end } = monthRange(year, month);
      all = all.filter((r) => {
        const d = r.boughtAt;
        return d && d >= start && d < end;
      });
    }

    if (search) {
      all = all.filter((r) =>
        r.title.toLowerCase().includes(search)
        || (r.article || "").toLowerCase().includes(search)
        || (r.shop || "").toLowerCase().includes(search)
        || (r.notes || "").toLowerCase().includes(search),
      );
    }

    return c.json({ buyouts: all }, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const title = String(body.title || "").trim();
    const amount = Number(body.amount);
    if (!title) return c.json({ error: "Укажите наименование" }, 400);
    if (!amount || Number.isNaN(amount) || amount <= 0) return c.json({ error: "Укажите сумму" }, 400);

    const boughtAt = body.boughtAt ? new Date(body.boughtAt) : new Date();
    if (Number.isNaN(boughtAt.getTime())) return c.json({ error: "Некорректная дата" }, 400);

    const userId = c.get("userId") as number;
    const [row] = await db.insert(schema.partsBuyouts).values({
      title,
      article: body.article?.trim() || null,
      shop: body.shop?.trim() || null,
      amount,
      notes: body.notes?.trim() || null,
      boughtAt,
      createdBy: userId,
      tenantId: tenantId(),
    }).returning();

    void trackActivityEvent(userId, "buyout_created", "buyout", row.id, { amount });

    return c.json({ buyout: row }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    const body = await c.req.json();

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.title != null) patch.title = String(body.title).trim();
    if (body.article != null) patch.article = body.article?.trim() || null;
    if (body.shop != null) patch.shop = body.shop?.trim() || null;
    if (body.notes != null) patch.notes = body.notes?.trim() || null;
    if (body.amount != null) {
      const amount = Number(body.amount);
      if (Number.isNaN(amount) || amount <= 0) return c.json({ error: "Некорректная сумма" }, 400);
      patch.amount = amount;
    }
    if (body.boughtAt != null) {
      const d = new Date(body.boughtAt);
      if (Number.isNaN(d.getTime())) return c.json({ error: "Некорректная дата" }, 400);
      patch.boughtAt = d;
    }

    const [row] = await db.update(schema.partsBuyouts).set(patch)
      .where(withTenant(schema.partsBuyouts, eq(schema.partsBuyouts.id, id)))
      .returning();
    if (!row) return c.json({ error: "Запись не найдена" }, 404);
    return c.json({ buyout: row }, 200);
  })
  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    await db.delete(schema.partsBuyouts).where(withTenant(schema.partsBuyouts, eq(schema.partsBuyouts.id, id)));
    return c.json({ ok: true }, 200);
  });
