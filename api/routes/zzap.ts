import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, asc, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import {
  getZzapSettings,
  isZzapConfigured,
  maskZzapSecret,
  saveZzapPriceFile,
  deleteZzapPriceFile,
  readZzapPriceFile,
  uploadZzapPriceList,
  uploadAllZzapPriceLists,
  prepareZzapPriceFileForDownload,
  touchZzapPriceFile,
} from "../lib/zzap";
import { zzapPublicFileUrl } from "../integrations/zzap";
import { usesZzapExternalLinkMode } from "../lib/zzap";
import { getPublicUrl } from "../lib/config";
import { zzapTemplateKind, ZZAP_KIND_HINTS, ZZAP_CABINET_NAMES } from "../lib/zzap-templates";
import { resetZzapBumpState } from "../lib/zzap-bump";
import { checkZzapPublicAccess } from "../lib/zzap-public";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { jsonApiError } from "../lib/api-error";

async function requireAdmin(c: { get: (k: string) => unknown }) {
  const userId = c.get("userId") as number;
  const [user] = await db.select().from(schema.users)
    .where(withTenant(schema.users, eq(schema.users.id, userId)));
  if (user?.role !== "admin") return null;
  return user;
}

function serveZzapPriceFile(list: typeof schema.zzapPriceLists.$inferSelect) {
  if (!list.storedFileName) return null;
  const buffer = readZzapPriceFile(list.storedFileName);
  if (!buffer) return null;
  const out = prepareZzapPriceFileForDownload(buffer, list.fileName);
  const ext = (list.fileName || "").toLowerCase();
  const mime = ext.endsWith(".xlsx") || ext.endsWith(".xltx")
    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    : ext.endsWith(".xls")
      ? "application/vnd.ms-excel"
      : "application/octet-stream";
  const now = new Date().toUTCString();
  return new Response(new Uint8Array(out), {
    headers: {
      "Content-Type": mime,
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Last-Modified": now,
      "Expires": "0",
    },
  });
}

export const zzap = new Hono()
  .get("/template/:code/:filename", async (c) => {
    if (!checkZzapPublicAccess(c)) return c.text("Forbidden", 403);
    const code = parseInt(c.req.param("code"));
    const [list] = await db.select().from(schema.zzapPriceLists).where(eq(schema.zzapPriceLists.codeTemplate, code));
    if (!list) return c.text("Not found", 404);
    const res = serveZzapPriceFile(list);
    if (!res) return c.text("Not found", 404);
    return res;
  })

  .get("/files/:id/:filename", async (c) => {
    // Sequential id — без токена нельзя (утечка прайсов чужих тенантов)
    if (!checkZzapPublicAccess(c, { requireToken: true })) return c.text("Forbidden", 403);
    const id = parseInt(c.req.param("id"));
    const [list] = await db.select().from(schema.zzapPriceLists).where(eq(schema.zzapPriceLists.id, id));
    if (!list) return c.text("Not found", 404);
    const res = serveZzapPriceFile(list);
    if (!res) return c.text("Not found", 404);
    return res;
  })

  .use("*", requireAuth)

  .get("/status", async (c) => {
    const settings = await getZzapSettings();
    const lists = await db.select().from(schema.zzapPriceLists)
      .where(forTenant(schema.zzapPriceLists))
      .orderBy(asc(schema.zzapPriceLists.sortOrder));
    return c.json({
      configured: isZzapConfigured(settings),
      externalLinkMode: usesZzapExternalLinkMode(settings),
      autoUploadEnabled: settings.autoUploadEnabled,
      uploadTime: `${String(settings.uploadHour ?? 9).padStart(2, "0")}:${String(settings.uploadMinute ?? 0).padStart(2, "0")} МСК`,
      lastRunAt: settings.lastRunAt,
      lastRunStatus: settings.lastRunStatus,
      lastRunError: settings.lastRunError,
      priceListsCount: lists.length,
      enabledListsCount: lists.filter((l) => l.enabled && l.storedFileName).length,
    }, 200);
  })

  .get("/settings", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const settings = await getZzapSettings();
    return c.json({
      settings: {
        ...settings,
        password: maskZzapSecret(settings.password),
        apiKey: maskZzapSecret(settings.apiKey),
      },
    }, 200);
  })

  .patch("/settings", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const body = await c.req.json();
    const current = await getZzapSettings();

    const [updated] = await db.update(schema.zzapSettings).set({
      enabled: body.enabled ?? current.enabled,
      login: body.login ?? current.login,
      password: body.password && !String(body.password).includes("••••")
        ? body.password : current.password,
      apiKey: body.apiKey && !String(body.apiKey).includes("••••")
        ? body.apiKey : current.apiKey,
      autoUploadEnabled: body.autoUploadEnabled ?? current.autoUploadEnabled,
      uploadHour: body.uploadHour != null ? Number(body.uploadHour) : current.uploadHour,
      uploadMinute: body.uploadMinute != null ? Number(body.uploadMinute) : current.uploadMinute,
      updatedAt: new Date(),
    }).where(withTenant(schema.zzapSettings, eq(schema.zzapSettings.id, current.id))).returning();

    return c.json({
      settings: {
        ...updated,
        password: maskZzapSecret(updated.password),
        apiKey: maskZzapSecret(updated.apiKey),
      },
    }, 200);
  })

  .get("/lists", async (c) => {
    const lists = await db.select().from(schema.zzapPriceLists)
      .where(forTenant(schema.zzapPriceLists))
      .orderBy(asc(schema.zzapPriceLists.sortOrder));
    const withUrls = lists.map((l) => {
      const kind = zzapTemplateKind(l.name);
      return {
        ...l,
        publicUrl: l.codeTemplate && l.storedFileName ? zzapPublicFileUrl(l.codeTemplate) : null,
        templateKind: kind,
        searchHint: ZZAP_KIND_HINTS[kind],
        cabinetName: ZZAP_CABINET_NAMES[l.name] || null,
      };
    });
    return c.json({ lists: withUrls, publicBase: getPublicUrl() }, 200);
  })

  .post("/lists", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const body = await c.req.json();
    if (!body.name?.trim()) return c.json({ error: "Укажите название прайса" }, 400);
    if (!body.codeTemplate) return c.json({ error: "Укажите код шаблона ZZap" }, 400);

    const [maxRow] = await db.select().from(schema.zzapPriceLists)
      .where(forTenant(schema.zzapPriceLists))
      .orderBy(desc(schema.zzapPriceLists.sortOrder)).limit(1);
    const [list] = await db.insert(schema.zzapPriceLists).values({
      tenantId: tenantId(),
      name: body.name.trim(),
      codeTemplate: Number(body.codeTemplate),
      enabled: body.enabled !== false,
      sortOrder: (maxRow?.sortOrder ?? 0) + 1,
    }).returning();

    return c.json({ list }, 201);
  })

  .patch("/lists/:id", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const [current] = await db.select().from(schema.zzapPriceLists)
      .where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, id)));
    if (!current) return c.json({ error: "Not found" }, 404);

    const [list] = await db.update(schema.zzapPriceLists).set({
      name: body.name?.trim() ?? current.name,
      codeTemplate: body.codeTemplate != null ? Number(body.codeTemplate) : current.codeTemplate,
      enabled: body.enabled ?? current.enabled,
      sortOrder: body.sortOrder ?? current.sortOrder,
      updatedAt: new Date(),
    }).where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, id))).returning();

    return c.json({ list }, 200);
  })

  .delete("/lists/:id", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const id = parseInt(c.req.param("id"));
    const [current] = await db.select().from(schema.zzapPriceLists)
      .where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, id)));
    if (!current) return c.json({ error: "Not found" }, 404);
    deleteZzapPriceFile(current.storedFileName);
    await db.delete(schema.zzapPriceLists)
      .where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, id)));
    return c.json({ ok: true }, 200);
  })

  .post("/lists/:id/file", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const id = parseInt(c.req.param("id"));
    const [list] = await db.select().from(schema.zzapPriceLists)
      .where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, id)));
    if (!list) return c.json({ error: "Not found" }, 404);

    const body = await c.req.parseBody();
    const file = body.file;
    if (!file || typeof file === "string") return c.json({ error: "Выберите файл (.xlsx)" }, 400);

    const f = file as File;
    const buffer = Buffer.from(await f.arrayBuffer());
    try {
      const saved = saveZzapPriceFile(buffer, f.name || "price.xlsx");
      deleteZzapPriceFile(list.storedFileName);
      resetZzapBumpState(saved.storedName);
      touchZzapPriceFile(saved.storedName, saved.fileName, list.codeTemplate);
      const [updated] = await db.update(schema.zzapPriceLists).set({
        storedFileName: saved.storedName,
        fileName: saved.fileName,
        lastUploadError: null,
        updatedAt: new Date(),
      }).where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, id))).returning();

      const uploadNow = body.uploadNow === "1" || body.uploadNow === "true";
      let uploadResult = null;
      if (uploadNow) {
        uploadResult = await uploadZzapPriceList(id);
      }

      return c.json({ list: updated, upload: uploadResult }, 200);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка загрузки прайса", 400, "zzap_upload");
    }
  })

  .post("/lists/:id/upload", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const id = parseInt(c.req.param("id"));
    const result = await uploadZzapPriceList(id);
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, fileUrl: result.fileUrl }, 200);
  })

  .post("/upload-all", async (c) => {
    if (!await requireAdmin(c)) return c.json({ error: "Только для администратора" }, 403);
    const result = await uploadAllZzapPriceLists();
    return c.json(result, 200);
  });
