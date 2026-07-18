/**
 * API генерации официальных PDF-документов СТО.
 * POST /api/docs/generate { orderId, type }
 * GET  /api/docs/:id/download
 */
import { Hono } from "hono";
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { requireAuth } from "../middleware/auth";
import { buildDocData } from "../lib/doc-data";
import { getHtmlTemplate } from "../lib/doc-templates";
import { ensureDocsDir, generatePdf } from "../lib/pdf-generator";
import { isDocType, DOC_TYPE_LABELS } from "../lib/doc-types";
import { log } from "../lib/logger";
import { jsonApiError, isClientSafeError } from "../lib/api-error";
import { getTenantId } from "../lib/tenant-context";
import { forTenant, withTenant } from "../lib/tenant-query";

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const hits = new Map<number, number[]>();

function checkRateLimit(tenantId: number): boolean {
  const now = Date.now();
  const prev = (hits.get(tenantId) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_LIMIT) {
    hits.set(tenantId, prev);
    return false;
  }
  prev.push(now);
  hits.set(tenantId, prev);
  return true;
}

export const docsRoute = new Hono()
  .use("*", requireAuth)

  .post("/generate", async (c) => {
    const started = Date.now();
    const tenantId = getTenantId();
    const userId = c.get("userId") as number;

    if (!checkRateLimit(tenantId)) {
      return c.json({ error: "Лимит: не более 5 документов в минуту" }, 429);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "Некорректный JSON" }, 400);
    }

    const orderId = Number((body as { orderId?: unknown }).orderId);
    const typeRaw = (body as { type?: unknown }).type;
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return c.json({ error: "Укажите orderId (ID заказ-наряда)" }, 400);
    }
    if (!isDocType(typeRaw)) {
      return c.json({ error: "type: invoice | upd | act | order" }, 400);
    }

    try {
      const data = await buildDocData(orderId, typeRaw);
      const html = getHtmlTemplate(typeRaw, data);
      const pdf = await generatePdf(html);

      const dir = ensureDocsDir();
      const tenantDir = path.join(dir, String(tenantId));
      fs.mkdirSync(tenantDir, { recursive: true });
      const fileName = `${data.docNumber}.pdf`.replace(/[^\w.\-А-Яа-яЁё]+/g, "_");
      const absPath = path.join(tenantDir, `${Date.now()}-${fileName}`);
      fs.writeFileSync(absPath, pdf);

      const issuedAt = new Date();
      const [row] = await db
        .insert(schema.documents)
        .values({
          tenantId,
          dealId: orderId,
          type: typeRaw,
          status: "draft",
          docNumber: data.docNumber,
          pdfPath: absPath,
          fileName,
          issuedAt,
          createdBy: userId,
          createdAt: issuedAt,
        })
        .returning();

      const duration = Date.now() - started;
      log.info({
        tenantId,
        dealId: orderId,
        type: typeRaw,
        documentId: row.id,
        duration,
      }, "docs_generate_ok");

      return c.json({
        id: row.id,
        type: typeRaw,
        title: DOC_TYPE_LABELS[typeRaw],
        docNumber: data.docNumber,
        fileName,
        issuedAt: issuedAt.toISOString(),
        pdfUrl: `/api/docs/${row.id}/download`,
      });
    } catch (e: unknown) {
      if (isClientSafeError(e) && e.status === 404) {
        return c.json({ error: e.message }, 404);
      }
      return jsonApiError(c, e, "Ошибка генерации PDF", 500, "docs_generate_error");
    }
  })

  .get("/:id/download", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isFinite(id)) return c.json({ error: "Некорректный id" }, 400);

    const [row] = await db
      .select()
      .from(schema.documents)
      .where(withTenant(schema.documents, eq(schema.documents.id, id)))
      .limit(1);

    if (!row) return c.json({ error: "Документ не найден" }, 404);
    if (!row.pdfPath || !fs.existsSync(row.pdfPath)) {
      return c.json({ error: "Файл PDF отсутствует на диске" }, 404);
    }

    const buf = fs.readFileSync(row.pdfPath);
    const name = row.fileName || `document-${row.id}.pdf`;
    return new Response(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "private, no-store",
      },
    });
  })

  .get("/", async (c) => {
    const dealId = Number(c.req.query("orderId") || c.req.query("dealId") || 0);
    const rows = await db
      .select({
        id: schema.documents.id,
        type: schema.documents.type,
        status: schema.documents.status,
        docNumber: schema.documents.docNumber,
        fileName: schema.documents.fileName,
        issuedAt: schema.documents.issuedAt,
        dealId: schema.documents.dealId,
        createdAt: schema.documents.createdAt,
      })
      .from(schema.documents)
      .where(
        dealId > 0
          ? withTenant(schema.documents, eq(schema.documents.dealId, dealId))
          : forTenant(schema.documents),
      )
      .orderBy(desc(schema.documents.id));

    return c.json({
      documents: rows.map((r) => ({
        ...r,
        pdfUrl: `/api/docs/${r.id}/download`,
      })),
    });
  });
