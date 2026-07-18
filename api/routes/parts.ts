import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { filterDemoParts, isDemoUser } from "../lib/demo-mode";
import { filterPartsBySearch } from "../lib/parts-search";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { ensureStoExtendedTables } from "../lib/sto-extended-bootstrap";

const PART_PATCH_KEYS = [
  "article", "brand", "name", "category", "qty", "price", "purchasePrice",
  "markupPercent", "unit", "country", "oemArticles", "location", "minQty", "barcode",
] as const;

/** Группы как в Автодиллере — показываются даже без позиций */
export const DEFAULT_PART_CATEGORIES = [
  "ПОДВЕСКА ХОДОВКА",
  "ПОДШИПНИКИ",
  "ПРИВОДА",
  "ПРОКЛАДКИ",
  "РАЗДАТКИ",
  "ДВИГАТЕЛЬ",
  "ТРАНСМИССИЯ",
  "ТОРМОЗА",
  "КУЗОВ",
  "ЭЛЕКТРИКА",
  "ФИЛЬТРЫ",
  "МАСЛА ЖИДКОСТИ",
  "РАСХОДНИКИ",
  "ПРОЧЕЕ",
] as const;

function pickPartPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of PART_PATCH_KEYS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  return patch;
}

function normalizeOem(raw: unknown): string | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const list = raw.map((x) => String(x).trim()).filter(Boolean);
    return list.length ? JSON.stringify(list) : null;
  }
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("[")) {
    try {
      const parsed = JSON.parse(s) as unknown;
      if (Array.isArray(parsed)) {
        const list = parsed.map((x) => String(x).trim()).filter(Boolean);
        return list.length ? JSON.stringify(list) : null;
      }
    } catch { /* fallthrough */ }
  }
  const list = s.split(/[,;\n]+/).map((x) => x.trim()).filter(Boolean);
  return list.length ? JSON.stringify(list) : null;
}

async function ensureDefaultCategories() {
  await ensureStoExtendedTables();
  const tid = tenantId();
  const existing = await db.select().from(schema.partsCategories)
    .where(forTenant(schema.partsCategories));
  if (existing.length > 0) return;
  let order = 0;
  for (const name of DEFAULT_PART_CATEGORIES) {
    await db.insert(schema.partsCategories).values({
      tenantId: tid,
      name,
      sortOrder: order++,
    });
  }
}

export const parts = new Hono()
  .use("*", requireAuth)

  .get("/categories", async (c) => {
    await ensureDefaultCategories();
    const tid = tenantId();
    const cats = await db.select().from(schema.partsCategories)
      .where(forTenant(schema.partsCategories))
      .orderBy(asc(schema.partsCategories.sortOrder), asc(schema.partsCategories.name));

    let partsList = await db.select({
      category: schema.partsStock.category,
    }).from(schema.partsStock).where(forTenant(schema.partsStock));
    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      const all = await db.select().from(schema.partsStock).where(forTenant(schema.partsStock));
      partsList = filterDemoParts(user, all).map((p) => ({ category: p.category }));
    }

    const countMap = new Map<string, number>();
    let uncategorized = 0;
    for (const p of partsList) {
      const name = (p.category || "").trim();
      if (!name) {
        uncategorized += 1;
        continue;
      }
      countMap.set(name, (countMap.get(name) || 0) + 1);
    }

    const known = new Set(cats.map((c) => c.name));
    const orphanNames = [...countMap.keys()].filter((n) => !known.has(n)).sort((a, b) => a.localeCompare(b, "ru"));

    const categories = [
      ...cats.map((c) => ({
        id: c.id,
        name: c.name,
        sortOrder: c.sortOrder ?? 0,
        count: countMap.get(c.name) || 0,
      })),
      ...orphanNames.map((name, i) => ({
        id: null as number | null,
        name,
        sortOrder: 10_000 + i,
        count: countMap.get(name) || 0,
      })),
    ];

    return c.json({
      categories,
      uncategorized,
      total: partsList.length,
      tenantId: tid,
    }, 200);
  })

  .post("/categories", async (c) => {
    await ensureDefaultCategories();
    const body = await c.req.json() as { name?: string };
    const name = (body.name || "").trim().toUpperCase();
    if (!name) return c.json({ error: "Укажите название группы" }, 400);

    const [dup] = await db.select().from(schema.partsCategories)
      .where(and(forTenant(schema.partsCategories), eq(schema.partsCategories.name, name)));
    if (dup) return c.json({ error: "Такая группа уже есть", category: dup }, 409);

    const existing = await db.select().from(schema.partsCategories).where(forTenant(schema.partsCategories));
    const [category] = await db.insert(schema.partsCategories).values({
      tenantId: tenantId(),
      name,
      sortOrder: existing.length,
    }).returning();
    return c.json({ category }, 201);
  })

  .patch("/categories/:id", async (c) => {
    await ensureDefaultCategories();
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    const body = await c.req.json() as { name?: string; sortOrder?: number };
    const [existing] = await db.select().from(schema.partsCategories)
      .where(withTenant(schema.partsCategories, eq(schema.partsCategories.id, id)));
    if (!existing) return c.json({ error: "Группа не найдена" }, 404);

    const patch: { name?: string; sortOrder?: number } = {};
    if (body.name != null) {
      const name = body.name.trim().toUpperCase();
      if (!name) return c.json({ error: "Пустое название" }, 400);
      patch.name = name;
    }
    if (body.sortOrder != null) patch.sortOrder = Number(body.sortOrder) || 0;

    if (patch.name && patch.name !== existing.name) {
      await db.update(schema.partsStock)
        .set({ category: patch.name, updatedAt: new Date() })
        .where(and(forTenant(schema.partsStock), eq(schema.partsStock.category, existing.name)));
    }

    const [category] = await db.update(schema.partsCategories)
      .set(patch)
      .where(withTenant(schema.partsCategories, eq(schema.partsCategories.id, id)))
      .returning();
    return c.json({ category }, 200);
  })

  .delete("/categories/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    const [existing] = await db.select().from(schema.partsCategories)
      .where(withTenant(schema.partsCategories, eq(schema.partsCategories.id, id)));
    if (!existing) return c.json({ error: "Группа не найдена" }, 404);

    await db.update(schema.partsStock)
      .set({ category: null, updatedAt: new Date() })
      .where(and(forTenant(schema.partsStock), eq(schema.partsStock.category, existing.name)));

    await db.delete(schema.partsCategories)
      .where(withTenant(schema.partsCategories, eq(schema.partsCategories.id, id)));
    return c.json({ ok: true }, 200);
  })

  .get("/", async (c) => {
    await ensureStoExtendedTables();
    const search = (c.req.query("search") || "").trim();
    const articleFocus = c.req.query("article") === "1" || c.req.query("mode") === "article";
    const lowStock = c.req.query("lowStock") === "1";
    const category = (c.req.query("category") || "").trim();
    const uncategorized = c.req.query("uncategorized") === "1";
    const limitRaw = parseInt(c.req.query("limit") || "", 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : (search ? 50 : 200);

    let all = await db.select().from(schema.partsStock)
      .where(forTenant(schema.partsStock))
      .orderBy(schema.partsStock.name);
    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      all = filterDemoParts(user, all);
    }
    if (category) {
      all = all.filter((p) => (p.category || "").trim() === category);
    } else if (uncategorized) {
      all = all.filter((p) => !(p.category || "").trim());
    }
    if (search) {
      all = filterPartsBySearch(all, search, { articleFocus, limit });
    } else {
      all = all.slice(0, limit);
    }
    if (lowStock) {
      all = all.filter((p) => (p.qty ?? 0) <= (p.minQty || 1));
    }
    return c.json({ parts: all }, 200);
  })

  .post("/", async (c) => {
    await ensureStoExtendedTables();
    const body = await c.req.json();
    const [part] = await db.insert(schema.partsStock).values({
      article: body.article,
      brand: body.brand,
      name: body.name,
      category: body.category ? String(body.category).trim() : null,
      qty: body.qty ?? 0,
      price: body.price,
      purchasePrice: body.purchasePrice ?? null,
      markupPercent: body.markupPercent ?? null,
      unit: body.unit || "шт",
      country: body.country || null,
      oemArticles: normalizeOem(body.oemArticles),
      location: body.location,
      minQty: body.minQty ?? 1,
      barcode: body.barcode || null,
      tenantId: tenantId(),
    }).returning();
    return c.json({ part }, 201);
  })

  .patch("/:id", async (c) => {
    await ensureStoExtendedTables();
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json() as Record<string, unknown>;
    if (body.oemArticles !== undefined) {
      body.oemArticles = normalizeOem(body.oemArticles);
    }
    const [part] = await db.update(schema.partsStock)
      .set(pickPartPatch(body))
      .where(withTenant(schema.partsStock, eq(schema.partsStock.id, id)))
      .returning();
    return c.json({ part }, 200);
  })

  .post("/:id/duplicate", async (c) => {
    await ensureStoExtendedTables();
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    const [src] = await db.select().from(schema.partsStock)
      .where(withTenant(schema.partsStock, eq(schema.partsStock.id, id)));
    if (!src) return c.json({ error: "Не найдено" }, 404);
    const [part] = await db.insert(schema.partsStock).values({
      tenantId: tenantId(),
      article: `${src.article}-copy`,
      brand: src.brand,
      name: `${src.name} (копия)`,
      category: src.category,
      qty: 0,
      price: src.price,
      purchasePrice: src.purchasePrice,
      markupPercent: src.markupPercent,
      unit: src.unit || "шт",
      country: src.country,
      oemArticles: src.oemArticles,
      location: src.location,
      minQty: src.minQty ?? 1,
      barcode: null,
    }).returning();
    return c.json({ part }, 201);
  })

  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    await db.delete(schema.partsStock).where(withTenant(schema.partsStock, eq(schema.partsStock.id, id)));
    return c.json({ ok: true }, 200);
  })

  .get("/lookup", async (c) => {
    const q = c.req.query("q") || "";
    const all = await db.select().from(schema.partsStock).where(forTenant(schema.partsStock));
    const found = all.filter((p) =>
      p.article.toLowerCase() === q.toLowerCase() ||
      p.name.toLowerCase().includes(q.toLowerCase()),
    );
    return c.json({ parts: found.slice(0, 20) }, 200);
  })

  .get("/by-barcode/:code", async (c) => {
    const code = (c.req.param("code") || "").trim();
    if (!code) return c.json({ error: "Пустой код" }, 400);
    const all = await db.select().from(schema.partsStock).where(forTenant(schema.partsStock));
    const part = all.find((p) =>
      (p as { barcode?: string | null }).barcode === code
      || p.article.toLowerCase() === code.toLowerCase(),
    );
    if (!part) return c.json({ error: "Не найдено" }, 404);
    return c.json({ part }, 200);
  });
