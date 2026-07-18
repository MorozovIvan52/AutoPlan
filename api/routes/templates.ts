import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, asc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import {
  normalizeTemplateRow,
  stringifyTemplateMediaUrls,
  parseTemplateMediaUrls,
  type TemplateMedia,
} from "../lib/template-media";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";

function normalizeTemplateField(value: string) {
  return value.trim().toLowerCase().replace(/\r\n/g, "\n").replace(/\s+/g, " ");
}

function findTemplateDuplicate(
  rows: { id: number; title: string; text: string }[],
  title: string,
  text: string,
  excludeId?: number,
) {
  const nt = normalizeTemplateField(title);
  const nx = normalizeTemplateField(text);
  let titleMatch: (typeof rows)[number] | null = null;

  for (const row of rows) {
    if (excludeId != null && row.id === excludeId) continue;
    const rt = normalizeTemplateField(row.title);
    const rx = normalizeTemplateField(row.text);
    if (rt === nt && rx === nx) {
      return { kind: "full" as const, row };
    }
    if (rx === nx) {
      return { kind: "text" as const, row };
    }
    if (rt === nt && !titleMatch) titleMatch = row;
  }

  if (titleMatch) return { kind: "title" as const, row: titleMatch };
  return null;
}

function duplicateTemplateMessage(kind: "full" | "title" | "text", existingTitle?: string) {
  if (kind === "full") return "Такой шаблон уже существует";
  if (kind === "title") return "Шаблон с таким названием уже существует";
  return existingTitle
    ? `Такой текст уже есть в шаблоне «${existingTitle}»`
    : "Шаблон с таким текстом уже существует";
}

function prepareTemplateBody(body: Record<string, unknown>) {
  let mediaUrls: TemplateMedia[] = [];
  if (Array.isArray(body.mediaUrls)) {
    mediaUrls = body.mediaUrls
      .filter((m: any) => m && typeof m.url === "string")
      .map((m: any) => ({
        url: m.url,
        type: m.type === "video" || m.type === "document" ? m.type : "photo",
      }));
  } else if (typeof body.imageUrl === "string" && body.imageUrl) {
    mediaUrls = [{ url: body.imageUrl, type: "photo" }];
  }

  return {
    title: String(body.title ?? ""),
    text: String(body.text ?? ""),
    category: typeof body.category === "string" ? body.category : undefined,
    sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
    imageUrl: mediaUrls[0]?.url || (typeof body.imageUrl === "string" ? body.imageUrl : null) || null,
    mediaUrls: stringifyTemplateMediaUrls(mediaUrls),
  };
}

export const templates = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const category = c.req.query("category");
    let all = await db.select().from(schema.quickTemplates)
      .where(forTenant(schema.quickTemplates))
      .orderBy(asc(schema.quickTemplates.sortOrder));
    if (category) all = all.filter((t) => t.category === category);
    return c.json({ templates: all.map(normalizeTemplateRow) }, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const title = String(body.title || "").trim();
    const text = String(body.text || "").trim();
    if (!title || !text) {
      return c.json({ error: "Укажите название и текст шаблона" }, 400);
    }
    const existing = await db.select().from(schema.quickTemplates).where(forTenant(schema.quickTemplates));
    const duplicate = findTemplateDuplicate(existing, title, text);
    if (duplicate) {
      return c.json({
        error: duplicateTemplateMessage(duplicate.kind, duplicate.row.title),
      }, 409);
    }
    const [tpl] = await db.insert(schema.quickTemplates).values({
      ...prepareTemplateBody({ ...body, title, text }),
      tenantId: tenantId(),
    }).returning();
    return c.json({ template: normalizeTemplateRow(tpl) }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const [current] = await db.select().from(schema.quickTemplates)
      .where(withTenant(schema.quickTemplates, eq(schema.quickTemplates.id, id)));
    if (!current) return c.json({ error: "Шаблон не найден" }, 404);

    const patch: Record<string, unknown> = {};
    if (body.title != null) patch.title = String(body.title).trim();
    if (body.text != null) patch.text = String(body.text).trim();
    if (body.category != null) patch.category = body.category;
    if (body.sortOrder != null) patch.sortOrder = body.sortOrder;

    const nextTitle = body.title != null ? String(body.title).trim() : current.title;
    const nextText = body.text != null ? String(body.text).trim() : current.text;
    if (!nextTitle || !nextText) {
      return c.json({ error: "Укажите название и текст шаблона" }, 400);
    }
    const existing = await db.select().from(schema.quickTemplates).where(forTenant(schema.quickTemplates));
    const duplicate = findTemplateDuplicate(existing, nextTitle, nextText, id);
    if (duplicate) {
      return c.json({
        error: duplicateTemplateMessage(duplicate.kind, duplicate.row.title),
      }, 409);
    }

    if (body.mediaUrls !== undefined || body.imageUrl !== undefined) {
      const prepared = prepareTemplateBody({ title: current.title, text: current.text, ...body });
      patch.imageUrl = prepared.imageUrl;
      patch.mediaUrls = prepared.mediaUrls;
    }

    const [tpl] = await db.update(schema.quickTemplates).set(patch)
      .where(withTenant(schema.quickTemplates, eq(schema.quickTemplates.id, id)))
      .returning();
    return c.json({ template: normalizeTemplateRow(tpl) }, 200);
  })
  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    await db.delete(schema.quickTemplates).where(withTenant(schema.quickTemplates, eq(schema.quickTemplates.id, id)));
    return c.json({ ok: true }, 200);
  });
