import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { isDemoUser, getDemoClientIds } from "../lib/demo-mode";
import { trackActivityEvent } from "../lib/activity-track";
import {
  calcItemsTotal,
  defaultCompanyName,
  deductStockForDocumentStrict,
  nextDocNumber,
  recalcDocumentTotal,
  restoreStockForDocument,
} from "../lib/sales-db";

import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getSalesDocInTenant } from "../lib/tenant-guard";
import { pushDocumentTo1C, registerCashReceipt } from "../integrations/onec";
import { getCrmSettings } from "../lib/crm-settings";
import { insertSalesItemsFromDeal } from "../lib/sales-from-deal";

async function loadDocument(id: number) {
  const doc = await getSalesDocInTenant(id);
  if (!doc) return null;

  const items = await db.select().from(schema.salesDocumentItems)
    .where(eq(schema.salesDocumentItems.documentId, id))
    .orderBy(schema.salesDocumentItems.sortOrder, schema.salesDocumentItems.id);

  let client = null;
  if (doc.clientId) {
    const [c] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, doc.clientId)));
    client = c ?? null;
  }

  let manager = null;
  if (doc.managerId) {
    const [u] = await db.select().from(schema.users).where(withTenant(schema.users, eq(schema.users.id, doc.managerId)));
    if (u) manager = { id: u.id, name: u.name };
  }

  return { doc, items, client, manager };
}

export const sales = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const docType = c.req.query("docType");
    const status = c.req.query("status");
    const dealIdRaw = c.req.query("dealId");
    const dealId = dealIdRaw ? parseInt(dealIdRaw, 10) : null;
    const enterpriseIdRaw = c.req.query("enterpriseId");
    const enterpriseId = enterpriseIdRaw ? parseInt(enterpriseIdRaw, 10) : null;
    const search = (c.req.query("search") || "").trim().toLowerCase();

    let rows = await db.select().from(schema.salesDocuments)
      .where(forTenant(schema.salesDocuments))
      .orderBy(desc(schema.salesDocuments.createdAt));

    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      const demoClients = new Set(await getDemoClientIds());
      rows = rows.filter((d) => d.clientId != null && demoClients.has(d.clientId));
    }

    if (dealId && !Number.isNaN(dealId)) {
      rows = rows.filter((d) => d.dealId === dealId);
    }

    if (enterpriseId && !Number.isNaN(enterpriseId)) {
      const dealIds = (await db.select({ id: schema.deals.id })
        .from(schema.deals)
        .where(withTenant(schema.deals, eq(schema.deals.woEnterpriseId, enterpriseId))))
        .map((d) => d.id);
      const dealIdSet = new Set(dealIds);
      rows = rows.filter((d) => d.dealId != null && dealIdSet.has(d.dealId));
    }

    if (docType === "receipt" || docType === "invoice") {
      rows = rows.filter((d) => d.docType === docType);
    }
    if (status) rows = rows.filter((d) => d.status === status);
    if (search) {
      rows = rows.filter((d) =>
        d.docNumber.toLowerCase().includes(search)
        || (d.recipientName || "").toLowerCase().includes(search)
        || (d.companyName || "").toLowerCase().includes(search)
        || (d.notes || "").toLowerCase().includes(search)
        || (d.warrantyText || "").toLowerCase().includes(search),
      );
    }

    const clientIds = [...new Set(rows.map((d) => d.clientId).filter(Boolean))] as number[];
    const clientMap = new Map<number, typeof schema.clients.$inferSelect>();
    for (const cid of clientIds) {
      const [cl] = await db.select().from(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, cid)));
      if (cl) clientMap.set(cid, cl);
    }

    const documents = rows.map((d) => ({
      ...d,
      clientName: d.clientId ? clientMap.get(d.clientId)?.name : null,
    }));

    return c.json({ documents }, 200);
  })

  .get("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    const data = await loadDocument(id);
    if (!data) return c.json({ error: "Документ не найден" }, 404);
    return c.json(data, 200);
  })

  .post("/", async (c) => {
    const userId = c.get("userId") as number;
    const body = await c.req.json();
    const docType = body.docType === "invoice" ? "invoice" : "receipt";
    const companyName = (body.companyName || await defaultCompanyName()).trim();

    let clientId = body.clientId ? Number(body.clientId) : null;
    let recipientName = body.recipientName?.trim() || null;
    let recipientPhone = body.recipientPhone?.trim() || null;
    const dealId = body.dealId ? Number(body.dealId) : null;

    if (dealId && !Number.isNaN(dealId)) {
      const [deal] = await db.select().from(schema.deals).where(withTenant(schema.deals, eq(schema.deals.id, dealId)));
      if (deal) {
        clientId = deal.clientId;
        const [client] = await db.select().from(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, deal.clientId)));
        if (client) {
          recipientName = recipientName || client.name;
          recipientPhone = recipientPhone || client.phone || null;
        }
      }
    } else if (clientId && !Number.isNaN(clientId)) {
      const [client] = await db.select().from(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
      if (client) {
        recipientName = recipientName || client.name;
        recipientPhone = recipientPhone || client.phone || null;
      }
    }

    if (docType === "invoice" && !recipientName && !clientId) {
      return c.json({ error: "Для расходной накладной укажите получателя" }, 400);
    }

    const docNumber = await nextDocNumber(docType);
    const [doc] = await db.insert(schema.salesDocuments).values({
      docType,
      docNumber,
      status: "draft",
      clientId: clientId && !Number.isNaN(clientId) ? clientId : null,
      dealId: dealId && !Number.isNaN(dealId) ? dealId : null,
      managerId: userId,
      companyName,
      recipientName,
      recipientPhone,
      notes: body.notes?.trim() || null,
      warrantyText: body.warrantyText?.trim() || null,
      paymentMethod: body.paymentMethod?.trim() || "cash",
      tenantId: tenantId(),
    }).returning();

    if (dealId && !Number.isNaN(dealId)) {
      await insertSalesItemsFromDeal(doc.id, dealId);
    }

    const data = await loadDocument(doc.id);
    return c.json(data, 201);
  })

  /** Быстрый товарный чек: создать черновик + позиции (+ опционально провести) за один запрос */
  .post("/quick-receipt", async (c) => {
    const userId = c.get("userId") as number;
    const body = await c.req.json() as {
      items?: Array<{
        stockPartId?: number;
        article?: string;
        brand?: string;
        name?: string;
        qty?: number;
        price?: number;
      }>;
      paymentMethod?: string;
      clientId?: number;
      warrantyText?: string;
      post?: boolean;
    };

    const itemsIn = Array.isArray(body.items) ? body.items : [];
    if (!itemsIn.length) return c.json({ error: "Добавьте хотя бы одну позицию" }, 400);

    const companyName = await defaultCompanyName();
    const docNumber = await nextDocNumber("receipt");
    const paymentMethod = (body.paymentMethod || "cash").trim() || "cash";
    let clientId = body.clientId ? Number(body.clientId) : null;
    let recipientName: string | null = null;
    let recipientPhone: string | null = null;
    if (clientId && !Number.isNaN(clientId)) {
      const [client] = await db.select().from(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
      if (client) {
        recipientName = client.name;
        recipientPhone = client.phone || null;
      } else {
        clientId = null;
      }
    }

    const warrantyText = body.warrantyText?.trim() || null;

    const [doc] = await db.insert(schema.salesDocuments).values({
      docType: "receipt",
      docNumber,
      status: "draft",
      clientId,
      managerId: userId,
      companyName,
      recipientName,
      recipientPhone,
      warrantyText,
      paymentMethod,
      tenantId: tenantId(),
    }).returning();

    let sort = 0;
    for (const raw of itemsIn) {
      const qty = Math.max(1, Number(raw.qty) || 1);
      let name = (raw.name || "").trim();
      let article = raw.article?.trim() || null;
      let brand = raw.brand?.trim() || null;
      let price = raw.price != null ? Number(raw.price) : null;
      const stockPartId = raw.stockPartId ? Number(raw.stockPartId) : null;

      if (stockPartId && !Number.isNaN(stockPartId)) {
        const [part] = await db.select().from(schema.partsStock).where(withTenant(schema.partsStock, eq(schema.partsStock.id, stockPartId)));
        if (part) {
          name = name || part.name;
          article = article || part.article;
          brand = brand || part.brand;
          if (price == null || Number.isNaN(price)) price = part.price;
        }
      }
      if (!name) continue;

      if (stockPartId && !Number.isNaN(stockPartId)) {
        const existing = await db.select().from(schema.salesDocumentItems)
          .where(and(
            eq(schema.salesDocumentItems.documentId, doc.id),
            eq(schema.salesDocumentItems.stockPartId, stockPartId),
          ));
        if (existing[0]) {
          await db.update(schema.salesDocumentItems)
            .set({ qty: (existing[0].qty || 1) + qty })
            .where(eq(schema.salesDocumentItems.id, existing[0].id));
          continue;
        }
      }

      await db.insert(schema.salesDocumentItems).values({
        documentId: doc.id,
        stockPartId: stockPartId && !Number.isNaN(stockPartId) ? stockPartId : null,
        article,
        brand,
        name,
        qty,
        price: price != null && !Number.isNaN(price) ? price : null,
        sortOrder: sort++,
      });
    }

    await recalcDocumentTotal(doc.id);
    let data = await loadDocument(doc.id);
    if (!data?.items?.length) {
      await db.delete(schema.salesDocuments).where(eq(schema.salesDocuments.id, doc.id));
      return c.json({ error: "Не удалось добавить позиции" }, 400);
    }

    if (body.post) {
      const items = data.items || [];
      const total = calcItemsTotal(items, 0);
      try {
        await deductStockForDocumentStrict(doc.id);
      } catch (e: unknown) {
        await db.delete(schema.salesDocuments).where(eq(schema.salesDocuments.id, doc.id));
        const err = e as { message?: string; status?: number; code?: string };
        const status = err.status === 404 ? 404 : 409;
        return c.json({ error: err.message || "Ошибка склада", code: err.code }, status);
      }
      const [posted] = await db.update(schema.salesDocuments).set({
        status: "posted",
        paymentMethod,
        paymentAmount: total,
        totalAmount: total,
        postedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.salesDocuments.id, doc.id)).returning();
      data = await loadDocument(posted.id);
      void trackActivityEvent(userId, "sales_posted", "sales_document", posted.id, {
        docNumber: posted.docNumber,
        total: posted.totalAmount,
        quick: true,
      });

      const settings = await getCrmSettings();
      const fiscalItems = items.map((i) => ({
        name: i.name,
        qty: i.qty || 1,
        price: i.price || 0,
        sum: Math.round((i.price || 0) * (i.qty || 1) * 100) / 100,
      }));
      const fiscalPayload = {
        docId: posted.id,
        docNumber: posted.docNumber,
        docType: "receipt" as const,
        total,
        paymentMethod,
        items: fiscalItems,
        clientName: data?.client?.name || posted.recipientName,
        clientPhone: data?.client?.phone || posted.recipientPhone,
        companyInn: settings.companyInn,
      };
      const ofdResult = await registerCashReceipt(fiscalPayload);
      await db.update(schema.salesDocuments).set({
        ofdReceiptId: ofdResult.externalId || null,
        ofdStatus: ofdResult.status,
      }).where(eq(schema.salesDocuments.id, posted.id));
      const onecResult = await pushDocumentTo1C(fiscalPayload);
      if (onecResult.externalId) {
        await db.update(schema.salesDocuments).set({
          onecExportId: onecResult.externalId,
        }).where(eq(schema.salesDocuments.id, posted.id));
      }
      data = await loadDocument(posted.id);
      return c.json({ ...data, integrations: { onec: onecResult, ofd: ofdResult } }, 200);
    }

    return c.json(data, 201);
  })

  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);

    const [existing] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!existing) return c.json({ error: "Документ не найден" }, 404);
    if (existing.status !== "draft") return c.json({ error: "Редактировать можно только черновик" }, 400);

    const body = await c.req.json();
    const patch: Partial<typeof schema.salesDocuments.$inferInsert> = { updatedAt: new Date() };

    if (body.companyName !== undefined) patch.companyName = body.companyName?.trim() || null;
    if (body.recipientName !== undefined) patch.recipientName = body.recipientName?.trim() || null;
    if (body.recipientPhone !== undefined) patch.recipientPhone = body.recipientPhone?.trim() || null;
    if (body.notes !== undefined) patch.notes = body.notes?.trim() || null;
    if (body.warrantyText !== undefined) patch.warrantyText = body.warrantyText?.trim() || null;
    if (body.paymentMethod !== undefined) patch.paymentMethod = body.paymentMethod?.trim() || null;
    if (body.paymentAmount !== undefined) {
      patch.paymentAmount = body.paymentAmount != null && body.paymentAmount !== ""
        ? Number(body.paymentAmount) : null;
    }
    if (body.rounding !== undefined) patch.rounding = Number(body.rounding) || 0;
    if (body.clientId !== undefined) {
      const clientId = body.clientId ? Number(body.clientId) : null;
      patch.clientId = clientId && !Number.isNaN(clientId) ? clientId : null;
      if (clientId && !Number.isNaN(clientId)) {
        const [client] = await db.select().from(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
        if (client && body.recipientName === undefined) {
          patch.recipientName = client.name;
          patch.recipientPhone = client.phone || null;
        }
      }
    }
    if (body.managerId !== undefined) {
      const mid = Number(body.managerId);
      patch.managerId = Number.isInteger(mid) && mid > 0 ? mid : existing.managerId;
    }

    await db.update(schema.salesDocuments).set(patch).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    await recalcDocumentTotal(id);
    const data = await loadDocument(id);
    return c.json(data, 200);
  })

  .post("/:id/items", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json();

    const [doc] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!doc) return c.json({ error: "Документ не найден" }, 404);
    if (doc.status !== "draft") return c.json({ error: "Документ уже проведён" }, 400);

    const name = (body.name || "").trim();
    if (!name) return c.json({ error: "Укажите название позиции" }, 400);

    let article = body.article?.trim() || null;
    let brand = body.brand?.trim() || null;
    let price = body.price != null ? Number(body.price) : null;
    const stockPartId = body.stockPartId ? Number(body.stockPartId) : null;

    if (stockPartId && !Number.isNaN(stockPartId)) {
      const [part] = await db.select().from(schema.partsStock).where(withTenant(schema.partsStock, eq(schema.partsStock.id, stockPartId)));
      if (part) {
        article = article || part.article;
        brand = brand || part.brand;
        if (price == null || Number.isNaN(price)) price = part.price;
      }
    }

    const existingItems = await db.select().from(schema.salesDocumentItems)
      .where(eq(schema.salesDocumentItems.documentId, id));

    const addQty = Math.max(1, Number(body.qty) || 1);

    if (stockPartId && !Number.isNaN(stockPartId)) {
      const same = existingItems.find((i) => i.stockPartId === stockPartId);
      if (same) {
        const [item] = await db.update(schema.salesDocumentItems)
          .set({ qty: (same.qty || 1) + addQty })
          .where(eq(schema.salesDocumentItems.id, same.id))
          .returning();
        await recalcDocumentTotal(id);
        return c.json({ item, merged: true }, 200);
      }
    }

    const [item] = await db.insert(schema.salesDocumentItems).values({
      documentId: id,
      stockPartId: stockPartId && !Number.isNaN(stockPartId) ? stockPartId : null,
      article,
      brand,
      name,
      qty: addQty,
      price: price != null && !Number.isNaN(price) ? price : null,
      sortOrder: existingItems.length,
    }).returning();

    await recalcDocumentTotal(id);
    return c.json({ item }, 201);
  })

  .patch("/:id/items/:itemId", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const itemId = parseInt(c.req.param("itemId"), 10);
    const body = await c.req.json();

    const [doc] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!doc || doc.status !== "draft") return c.json({ error: "Редактирование недоступно" }, 400);

    const patch: Partial<typeof schema.salesDocumentItems.$inferInsert> = {};
    if (body.qty !== undefined) patch.qty = Math.max(1, Number(body.qty) || 1);
    if (body.price !== undefined) patch.price = body.price != null ? Number(body.price) : null;
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.article !== undefined) patch.article = body.article ? String(body.article).trim() : null;
    if (body.brand !== undefined) patch.brand = body.brand ? String(body.brand).trim() : null;

    await db.update(schema.salesDocumentItems).set(patch)
      .where(and(
        eq(schema.salesDocumentItems.id, itemId),
        eq(schema.salesDocumentItems.documentId, id),
      ));
    await recalcDocumentTotal(id);
    const [item] = await db.select().from(schema.salesDocumentItems)
      .where(and(
        eq(schema.salesDocumentItems.id, itemId),
        eq(schema.salesDocumentItems.documentId, id),
      ));
    return c.json({ item }, 200);
  })

  .delete("/:id/items/:itemId", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const itemId = parseInt(c.req.param("itemId"), 10);

    const [doc] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!doc || doc.status !== "draft") return c.json({ error: "Редактирование недоступно" }, 400);

    await db.delete(schema.salesDocumentItems).where(and(
      eq(schema.salesDocumentItems.id, itemId),
      eq(schema.salesDocumentItems.documentId, id),
    ));
    await recalcDocumentTotal(id);
    return c.json({ ok: true }, 200);
  })

  .post("/:id/post", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json().catch(() => ({}));

    const [doc] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!doc) return c.json({ error: "Документ не найден" }, 404);
    if (doc.status !== "draft") return c.json({ error: "Документ уже проведён" }, 400);

    const items = await db.select().from(schema.salesDocumentItems)
      .where(eq(schema.salesDocumentItems.documentId, id));
    if (items.length === 0) return c.json({ error: "Добавьте хотя бы одну позицию" }, 400);

    if (doc.docType === "invoice" && !doc.recipientName?.trim()) {
      return c.json({ error: "Укажите получателя для расходной накладной" }, 400);
    }

    const rounding = body.rounding != null ? Number(body.rounding) : (doc.rounding ?? 0);
    const total = calcItemsTotal(items, rounding);
    const paymentAmount = body.paymentAmount != null
      ? Number(body.paymentAmount)
      : (doc.paymentAmount ?? total);
    const paymentMethod = body.paymentMethod?.trim() || doc.paymentMethod || "cash";

    try {
      await deductStockForDocumentStrict(id);
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number; code?: string };
      const status = err.status === 404 ? 404 : 409;
      return c.json({ error: err.message || "Ошибка склада", code: err.code }, status);
    }

    const [posted] = await db.update(schema.salesDocuments).set({
      status: "posted",
      rounding,
      totalAmount: total,
      paymentAmount,
      paymentMethod,
      postedAt: new Date(),
      updatedAt: new Date(),
    }).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id))).returning();

    const data = await loadDocument(posted.id);
    void trackActivityEvent(posted.managerId || (c.get("userId") as number), "sales_posted", "sales_document", posted.id, {
      docNumber: posted.docNumber,
      total: posted.totalAmount,
    });

    const settings = await getCrmSettings();
    const fiscalItems = items.map((i) => ({
      name: i.name,
      qty: i.qty || 1,
      price: i.price || 0,
      sum: Math.round((i.price || 0) * (i.qty || 1) * 100) / 100,
    }));
    const fiscalPayload = {
      docId: posted.id,
      docNumber: posted.docNumber,
      docType: posted.docType as "receipt" | "invoice",
      total,
      paymentMethod,
      items: fiscalItems,
      clientName: data?.client?.name || posted.recipientName,
      clientPhone: data?.client?.phone || posted.recipientPhone,
      companyInn: settings.companyInn,
    };

    let onecResult = null;
    let ofdResult = null;
    if (posted.docType === "receipt") {
      ofdResult = await registerCashReceipt(fiscalPayload);
      await db.update(schema.salesDocuments).set({
        ofdReceiptId: ofdResult.externalId || null,
        ofdStatus: ofdResult.status,
      }).where(eq(schema.salesDocuments.id, posted.id));
    }
    onecResult = await pushDocumentTo1C(fiscalPayload);
    if (onecResult.externalId) {
      await db.update(schema.salesDocuments).set({
        onecExportId: onecResult.externalId,
      }).where(eq(schema.salesDocuments.id, posted.id));
    }

    return c.json({ ...data, integrations: { onec: onecResult, ofd: ofdResult } }, 200);
  })

  .post("/:id/cancel", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const [doc] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!doc) return c.json({ error: "Документ не найден" }, 404);
    if (doc.status !== "posted") return c.json({ error: "Отменить можно только проведённый документ" }, 400);

    await restoreStockForDocument(id);
    await db.update(schema.salesDocuments).set({
      status: "cancelled",
      updatedAt: new Date(),
    }).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));

    const data = await loadDocument(id);
    return c.json(data, 200);
  })

  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const [doc] = await db.select().from(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    if (!doc) return c.json({ error: "Документ не найден" }, 404);
    if (doc.status !== "draft" && doc.status !== "cancelled") {
      return c.json({ error: "Удалить можно только черновик или отменённый документ" }, 400);
    }

    await db.delete(schema.salesDocuments).where(withTenant(schema.salesDocuments, eq(schema.salesDocuments.id, id)));
    return c.json({ ok: true }, 200);
  });
