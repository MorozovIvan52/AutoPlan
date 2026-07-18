import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { isDemoUser, filterByDemoClients } from "../lib/demo-mode";
import { saveIncomingCallCard } from "../lib/telephony/call-card";
import { forTenant, tenantId } from "../lib/tenant-query";
import { getClientInTenant, getPartInTenant } from "../lib/tenant-guard";
import { jsonApiError } from "../lib/api-error";

export const calls = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const clientId = c.req.query("clientId");
    let rows = await db
      .select({
        call: schema.callLogs,
        client: schema.clients,
        user: schema.users,
      })
      .from(schema.callLogs)
      .leftJoin(schema.clients, eq(schema.callLogs.clientId, schema.clients.id))
      .leftJoin(schema.users, eq(schema.callLogs.userId, schema.users.id))
      .where(forTenant(schema.callLogs))
      .orderBy(desc(schema.callLogs.createdAt))
      .limit(100);

    if (clientId) {
      const cid = parseInt(clientId);
      rows = rows.filter((r) => r.call.clientId === cid);
    }

    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      rows = rows.filter((r) => r.client?.isDemo);
    }

    return c.json({
      calls: rows.map(({ call, client, user }) => ({
        ...call,
        clientName: client?.name,
        operatorName: user?.name,
      })),
    }, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const phone = (body.phone || "").trim();
    if (!phone) return c.json({ error: "Укажите телефон" }, 400);
    const clientId = body.clientId ? Number(body.clientId) : null;
    if (clientId) {
      const client = await getClientInTenant(clientId);
      if (!client) return c.json({ error: "Клиент не найден" }, 404);
    }

    const [call] = await db.insert(schema.callLogs).values({
      clientId,
      phone,
      userId: c.get("userId") as number,
      direction: body.direction || "outbound",
      notes: body.notes || null,
      outcome: body.outcome || "completed",
      tenantId: tenantId(),
    }).returning();

    return c.json({ call }, 201);
  })
  .patch("/:id/card", async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Некорректный id" }, 400);

    const body = await c.req.json();
    const userId = c.get("userId") as number;

    try {
      const result = await saveIncomingCallCard(id, userId, {
        callerName: body.callerName,
        reason: body.reason,
        vin: body.vin,
        article: body.article,
        createTask: Boolean(body.createTask),
        taskTitle: body.taskTitle,
      });
      return c.json(result, 200);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка сохранения", 400, "calls_save");
    }
  });
