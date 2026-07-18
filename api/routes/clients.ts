import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, like, sql, inArray, and, desc } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { enrichClientFromDialogs } from "../lib/client-enrich";
import {
  sanitizeClientSearch,
  findClientIdsByPhoneInRelatedTables,
  clientMatchesSearch,
} from "../lib/client-search";
import { filterDemoClientsList, isDemoUser, assertDemoClientAccess } from "../lib/demo-mode";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { jsonApiError } from "../lib/api-error";

const CLIENT_PATCH_KEYS = [
  "name", "phone", "email", "source", "externalId", "notes",
  "preferredMessenger", "productInterest", "avatarUrl",
  "discountPercent", "loyaltyCard",
] as const;

function pickClientPatch(body: Record<string, unknown>) {
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  for (const key of CLIENT_PATCH_KEYS) {
    if (body[key] !== undefined) patch[key] = body[key];
  }
  if (body.discountPercent !== undefined) {
    patch.discountPercent = Math.min(100, Math.max(0, Number(body.discountPercent) || 0));
  }
  return patch;
}

export const clients = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const rawSearch = c.req.query("search") || "";
    const rawPhoneDigits = c.req.query("phoneDigits") || "";
    const { search, phoneDigits: searchDigits } = sanitizeClientSearch(rawSearch);
    const phoneDigits = (rawPhoneDigits.replace(/\D/g, "") || searchDigits);
    const tagId = c.req.query("tagId");
    const source = c.req.query("source");

    let allClients = await db.select().from(schema.clients)
      .where(forTenant(schema.clients))
      .orderBy(sql`${schema.clients.updatedAt} desc`);
    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      allClients = filterDemoClientsList(user, allClients);
    }

    if (search || phoneDigits) {
      const q = search.toLowerCase();
      const vehicleClientIds = new Set<number>();
      try {
        if (q) {
          const vehicleRows = await db.select({ clientId: schema.vehicles.clientId })
            .from(schema.vehicles)
            .where(
              sql`lower(${schema.vehicles.vin}) like ${`%${q}%`}
                or lower(${schema.vehicles.plate}) like ${`%${q}%`}
                or lower(${schema.vehicles.make}) like ${`%${q}%`}
                or lower(${schema.vehicles.model}) like ${`%${q}%`}`,
            );
          for (const r of vehicleRows) vehicleClientIds.add(r.clientId);

          const dealRows = await db.select({ clientId: schema.deals.clientId })
            .from(schema.deals)
            .where(
              sql`lower(${schema.deals.vin}) like ${`%${q}%`}
                or lower(${schema.deals.vehiclePlate}) like ${`%${q}%`}`,
            );
          for (const r of dealRows) vehicleClientIds.add(r.clientId);
        }
      } catch (e) {
        console.warn("[clients] vehicle/deal search failed:", e);
      }

      let phoneChannelClientIds = new Set<number>();
      try {
        phoneChannelClientIds = await findClientIdsByPhoneInRelatedTables(search, phoneDigits);
      } catch (e) {
        console.warn("[clients] related phone search failed:", e);
      }

      allClients = allClients.filter((cl) => {
        if (clientMatchesSearch(cl, search, phoneDigits, vehicleClientIds, phoneChannelClientIds)) {
          return true;
        }
        // запасной матч по цифрам: 930… = +7930… / 8930…
        if (phoneDigits.length >= 7 && cl.phone) {
          const stored = cl.phone.replace(/\D/g, "");
          const tail = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : phoneDigits;
          if (stored.includes(tail) || stored.endsWith(tail)) return true;
          if (tail.length === 10) {
            if (stored.includes(`7${tail}`) || stored.includes(`8${tail}`)) return true;
            if (stored.slice(-10) === tail) return true;
          }
        }
        return false;
      });
    }
    if (source) {
      allClients = allClients.filter(cl => cl.source === source);
    }

    // Attach tags
    const clientIds = allClients.map(cl => cl.id);
    let tagsData: any[] = [];
    if (clientIds.length > 0) {
      tagsData = await db
        .select({ clientId: schema.clientTags.clientId, tag: schema.tags })
        .from(schema.clientTags)
        .innerJoin(schema.tags, eq(schema.clientTags.tagId, schema.tags.id))
        .where(inArray(schema.clientTags.clientId, clientIds));
    }

    if (tagId) {
      const tid = parseInt(tagId);
      const filteredIds = tagsData.filter(t => t.tag.id === tid).map(t => t.clientId);
      allClients = allClients.filter(cl => filteredIds.includes(cl.id));
    }

    const clientsWithTags = allClients.map(cl => ({
      ...cl,
      tags: tagsData.filter(t => t.clientId === cl.id).map(t => t.tag),
    }));

    return c.json({ clients: clientsWithTags }, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const [client] = await db.insert(schema.clients).values({
      name: body.name,
      phone: body.phone,
      email: body.email,
      source: body.source || "manual",
      externalId: body.externalId,
      notes: body.notes,
      tenantId: tenantId(),
    }).returning();
    return c.json({ client }, 201);
  })
  .get("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const [client] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, id)));
    if (!client) return c.json({ error: "Not found" }, 404);
    const user = c.get("user") as { role?: string };
    if (!(await assertDemoClientAccess(user, client.id))) return c.json({ error: "Not found" }, 404);

    const tags = await db
      .select({ tag: schema.tags })
      .from(schema.clientTags)
      .innerJoin(schema.tags, eq(schema.clientTags.tagId, schema.tags.id))
      .where(eq(schema.clientTags.clientId, id));

    const comments = await db
      .select({ comment: schema.clientComments, user: schema.users })
      .from(schema.clientComments)
      .leftJoin(schema.users, eq(schema.clientComments.userId, schema.users.id))
      .where(eq(schema.clientComments.clientId, id))
      .orderBy(sql`${schema.clientComments.createdAt} desc`);

    const convs = await db.select().from(schema.conversations)
      .where(and(forTenant(schema.conversations), eq(schema.conversations.clientId, id)));
    const dealsData = await db.select().from(schema.deals)
      .where(and(forTenant(schema.deals), eq(schema.deals.clientId, id)));
    const vehiclesData = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, id));

    return c.json({
      client: {
        ...client,
        tags: tags.map(t => t.tag),
        comments: comments.map(c => ({ ...c.comment, user: c.user ? { id: c.user.id, name: c.user.name } : null })),
        conversations: convs,
        deals: dealsData,
        vehicles: vehiclesData,
      }
    }, 200);
  })
  .post("/:id/enrich", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const conversationId = body.conversationId ? Number(body.conversationId) : undefined;
    const updated = await enrichClientFromDialogs(id, conversationId);
    if (!updated) return c.json({ error: "Клиент не найден" }, 404);

    const tags = await db
      .select({ tag: schema.tags })
      .from(schema.clientTags)
      .innerJoin(schema.tags, eq(schema.clientTags.tagId, schema.tags.id))
      .where(eq(schema.clientTags.clientId, id));
    const vehiclesData = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, id));

    return c.json({
      client: { ...updated, tags: tags.map((t) => t.tag), vehicles: vehiclesData },
      enriched: true,
    }, 200);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const [client] = await db.update(schema.clients)
      .set(pickClientPatch(body))
      .where(withTenant(schema.clients, eq(schema.clients.id, id)))
      .returning();
    return c.json({ client }, 200);
  })
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    await db.delete(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, id)));
    return c.json({ ok: true }, 200);
  })
  // Tags on client
  .post("/:id/tags", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const { tagId } = await c.req.json();
    const existing = await db.select().from(schema.clientTags)
      .where(eq(schema.clientTags.clientId, clientId));
    if (existing.find(t => t.tagId === tagId)) return c.json({ ok: true }, 200);
    await db.insert(schema.clientTags).values({ clientId, tagId });
    return c.json({ ok: true }, 201);
  })
  .delete("/:id/tags/:tagId", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const tagId = parseInt(c.req.param("tagId"));
    await db.delete(schema.clientTags)
      .where(and(eq(schema.clientTags.clientId, clientId), eq(schema.clientTags.tagId, tagId)));
    return c.json({ ok: true }, 200);
  })
  // Comments
  .get("/:id/comments", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const comments = await db
      .select({ comment: schema.clientComments, user: schema.users })
      .from(schema.clientComments)
      .leftJoin(schema.users, eq(schema.clientComments.userId, schema.users.id))
      .where(eq(schema.clientComments.clientId, clientId))
      .orderBy(sql`${schema.clientComments.createdAt} desc`);
    return c.json({ comments: comments.map(c => ({ ...c.comment, user: c.user ? { id: c.user.id, name: c.user.name } : null })) }, 200);
  })
  .post("/:id/comments", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const { text } = await c.req.json();
    const [comment] = await db.insert(schema.clientComments).values({ clientId, userId, text }).returning();
    return c.json({ comment }, 201);
  })
  // Deals
  .get("/:id/deals", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const [client] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
    if (!client) return c.json({ error: "Not found" }, 404);
    const dealsData = await db.select().from(schema.deals)
      .where(and(forTenant(schema.deals), eq(schema.deals.clientId, clientId)));
    return c.json({ deals: dealsData }, 200);
  })
  /** Полная история обслуживания — как у АвтоДилер / STOCRM */
  .get("/:id/service-history", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const [client] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
    if (!client) return c.json({ error: "Not found" }, 404);

    const deals = await db.select().from(schema.deals)
      .where(and(forTenant(schema.deals), eq(schema.deals.clientId, clientId)))
      .orderBy(desc(schema.deals.updatedAt));

    const appointments = await db.select().from(schema.serviceAppointments)
      .where(and(forTenant(schema.serviceAppointments), eq(schema.serviceAppointments.clientId, clientId)))
      .orderBy(desc(schema.serviceAppointments.scheduledAt));

    const calls = await db.select().from(schema.callLogs)
      .where(and(forTenant(schema.callLogs), eq(schema.callLogs.clientId, clientId)))
      .orderBy(desc(schema.callLogs.createdAt));

    const sales = await db.select().from(schema.salesDocuments)
      .where(and(
        forTenant(schema.salesDocuments),
        eq(schema.salesDocuments.clientId, clientId),
        eq(schema.salesDocuments.status, "posted"),
      ))
      .orderBy(desc(schema.salesDocuments.postedAt));

    type TimelineItem = {
      type: string;
      date: string;
      title: string;
      subtitle?: string;
      amount?: number;
      status?: string;
      link?: string;
      id: number;
    };

    const timeline: TimelineItem[] = [];

    for (const d of deals) {
      timeline.push({
        type: d.orderType === "service" ? "work_order" : "deal",
        date: (d.updatedAt || d.createdAt)?.toISOString?.() || "",
        title: d.title,
        subtitle: [d.vehiclePlate, d.vehicleMake, d.vehicleModel].filter(Boolean).join(" "),
        amount: d.amount ?? undefined,
        status: d.status ?? undefined,
        link: d.orderType === "service" ? `/zn/${d.id}` : `/deals`,
        id: d.id,
      });
    }
    for (const a of appointments) {
      timeline.push({
        type: "appointment",
        date: a.scheduledAt?.toISOString?.() || "",
        title: a.title,
        subtitle: [a.plate, a.make, a.model].filter(Boolean).join(" "),
        status: a.status ?? undefined,
        link: "/calendar",
        id: a.id,
      });
    }
    for (const call of calls) {
      timeline.push({
        type: "call",
        date: call.createdAt?.toISOString?.() || "",
        title: call.direction === "inbound" ? "Входящий звонок" : "Исходящий звонок",
        subtitle: call.phone || undefined,
        status: call.status || undefined,
        link: "/calls",
        id: call.id,
      });
    }
    for (const s of sales) {
      timeline.push({
        type: "sale",
        date: (s.postedAt || s.createdAt)?.toISOString?.() || "",
        title: `Реализация ${s.docNumber || s.id}`,
        amount: s.totalAmount ?? undefined,
        status: s.status ?? undefined,
        link: "/sales",
        id: s.id,
      });
    }

    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const totalSpent = deals
      .filter((d) => d.status === "done")
      .reduce((s, d) => s + (d.amount || 0), 0);

    return c.json({
      clientId,
      totalSpent: Math.round(totalSpent * 100) / 100,
      visitCount: appointments.filter((a) => a.status === "done").length,
      workOrderCount: deals.filter((d) => d.orderType === "service").length,
      timeline,
    }, 200);
  })
  .post("/:id/deals", async (c) => {
    const clientId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const title = (body.title || "").trim();
    if (!title) return c.json({ error: "Укажите название заказа" }, 400);
    try {
      const [deal] = await db.insert(schema.deals).values({
        clientId,
        title,
        orderType: body.orderType || "parts",
        status: body.status || "new",
        amount: body.amount != null ? Number(body.amount) : null,
        vin: body.vin || null,
        tenantId: tenantId(),
      }).returning();
      return c.json({ deal }, 201);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка БД", 500, "clients_db");
    }
  });
