import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, inArray, desc, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { sendWhatsAppToClient, sendWhatsAppToPhone } from "../services/service-notify";
import { sendToClientPreferred } from "../lib/client-notify";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";

async function sendToClient(
  clientId: number,
  text: string,
  channel: string,
  senderId?: number,
): Promise<{ ok: boolean; error?: string }> {
  if (channel === "auto") {
    const r = await sendToClientPreferred({
      clientId,
      text,
      preferredMessenger: "auto",
      senderId,
    });
    return { ok: r.ok, error: r.error };
  }

  if (channel === "whatsapp") {
    const r = await sendWhatsAppToClient(clientId, text, senderId);
    if (r.ok) return { ok: true };
    const [client] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
    if (client?.phone) {
      const r2 = await sendWhatsAppToPhone(client.phone, text, senderId);
      return { ok: r2.ok, error: r2.error };
    }
    return { ok: false, error: r.error };
  }

  const r = await sendToClientPreferred({
    clientId,
    text,
    preferredMessenger: channel as "telegram" | "avito",
    senderId,
  });
  return { ok: r.ok, error: r.error };
}

async function resolveTenantClientIds(tagIds: number[]): Promise<number[]> {
  const tenantTags = await db.select({ id: schema.tags.id }).from(schema.tags)
    .where(and(forTenant(schema.tags), inArray(schema.tags.id, tagIds)));
  const safeTagIds = tenantTags.map((t) => t.id);
  if (!safeTagIds.length) return [];

  const links = await db.select().from(schema.clientTags).where(inArray(schema.clientTags.tagId, safeTagIds));
  const clientIds = [...new Set(links.map((l) => l.clientId))];
  if (!clientIds.length) return [];

  const clients = await db.select({ id: schema.clients.id }).from(schema.clients)
    .where(and(forTenant(schema.clients), inArray(schema.clients.id, clientIds)));
  return clients.map((c) => c.id);
}

export const broadcasts = new Hono()
  .use("*", requireAuth)
  .get("/preview", async (c) => {
    const tagIdsRaw = c.req.query("tagIds") || "";
    const tagIds = tagIdsRaw.split(",").map((x) => parseInt(x.trim())).filter((n) => !Number.isNaN(n));
    if (!tagIds.length) return c.json({ count: 0, clients: [] }, 200);

    const clientIds = await resolveTenantClientIds(tagIds);
    const clients = clientIds.length
      ? await db.select().from(schema.clients).where(and(forTenant(schema.clients), inArray(schema.clients.id, clientIds)))
      : [];

    return c.json({
      count: clients.length,
      withPhone: clients.filter((cl) => cl.phone).length,
      clients: clients.slice(0, 50).map((cl) => ({ id: cl.id, name: cl.name, phone: cl.phone })),
    }, 200);
  })
  .get("/history", async (c) => {
    const rows = await db.select().from(schema.broadcasts)
      .where(forTenant(schema.broadcasts))
      .orderBy(desc(schema.broadcasts.createdAt))
      .limit(50);
    return c.json({ broadcasts: rows }, 200);
  })
  .post("/send", requireAdmin, async (c) => {
    const body = await c.req.json();
    const message = (body.message || "").trim();
    if (!message) return c.json({ error: "Введите текст рассылки" }, 400);

    const tagIds: number[] = Array.isArray(body.tagIds) ? body.tagIds.map(Number).filter(Boolean) : [];
    if (!tagIds.length) return c.json({ error: "Выберите хотя бы одну метку (сегмент)" }, 400);

    const channel = body.channel || "auto";
    const clientIds = await resolveTenantClientIds(tagIds);

    if (!clientIds.length) return c.json({ error: "Нет клиентов с выбранными метками" }, 400);

    const senderId = c.get("userId") as number;
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const clientId of clientIds) {
      const r = await sendToClient(clientId, message, channel, senderId);
      if (r.ok) sent++;
      else {
        failed++;
        if (r.error && errors.length < 5) errors.push(r.error);
      }
      await new Promise((r) => setTimeout(r, 300));
    }

    const [row] = await db.insert(schema.broadcasts).values({
      tenantId: tenantId(),
      title: body.title || `Рассылка ${new Date().toLocaleDateString("ru-RU")}`,
      message,
      tagIds: JSON.stringify(tagIds),
      channel,
      sent,
      failed,
      createdBy: senderId,
    }).returning();

    return c.json({ broadcast: row, sent, failed, total: clientIds.length, errors }, 200);
  });
