/**
 * api/routes/admin/clients.ts — админ: клиенты CRM и audit log
 */

import { Hono } from "hono";
import { eq, and, desc, like } from "drizzle-orm";
import { db } from "../../database";
import * as schema from "../../database/schema";
import { requireAuth, requireAdmin } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { getTenantId } from "../../lib/tenant-context";
import { getPlanLimits } from "../../lib/tenant";

export const adminClients = new Hono()
  .use("*", resolveTenant)
  .use("*", requireAuth)
  .use("*", requireAdmin)

  .get("/audit-log", async (c) => {
    const tid = getTenantId();
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;

    const logs = await db
      .select({
        id: schema.auditLogs.id,
        action: schema.auditLogs.action,
        resourceType: schema.auditLogs.resourceType,
        details: schema.auditLogs.details,
        userName: schema.users.name,
        userEmail: schema.users.email,
        createdAt: schema.auditLogs.createdAt,
      })
      .from(schema.auditLogs)
      .leftJoin(schema.users, eq(schema.auditLogs.userId, schema.users.id))
      .where(eq(schema.auditLogs.tenantId, tid))
      .orderBy(desc(schema.auditLogs.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      logs: logs.map((log) => ({
        ...log,
        details: log.details ? JSON.parse(log.details) : null,
      })),
      limit,
      offset,
    });
  })

  .get("/", async (c) => {
    const tid = getTenantId();
    const limit = Math.min(Number(c.req.query("limit")) || 50, 200);
    const offset = Number(c.req.query("offset")) || 0;
    const search = (c.req.query("search") || "").trim();

    const conditions = [eq(schema.clients.tenantId, tid)];
    if (search) {
      conditions.push(like(schema.clients.name, `%${search}%`));
    }

    const clients = await db
      .select()
      .from(schema.clients)
      .where(and(...conditions))
      .orderBy(desc(schema.clients.createdAt))
      .limit(limit)
      .offset(offset);

    const clientsWithCount = await Promise.all(
      clients.map(async (client) => {
        const convRows = await db
          .select({ id: schema.conversations.id })
          .from(schema.conversations)
          .where(eq(schema.conversations.clientId, client.id));
        return { ...client, conversationsCount: convRows.length };
      }),
    );

    return c.json({ clients: clientsWithCount, limit, offset });
  })

  .get("/:id/limits", async (c) => {
    const cid = Number(c.req.param("id"));
    const tid = getTenantId();

    const [client] = await db
      .select()
      .from(schema.clients)
      .where(and(eq(schema.clients.id, cid), eq(schema.clients.tenantId, tid)))
      .limit(1);

    if (!client) return c.json({ error: "Client not found" }, 404);

    const [tenant] = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, tid))
      .limit(1);

    if (!tenant) return c.json({ error: "Tenant not found" }, 500);

    const plan = getPlanLimits(tenant.subscriptionPlan);

    const activeUsers = await db
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.tenantId, tid), eq(schema.users.isActive, true)));

    const activeChannels = await db
      .select()
      .from(schema.channels)
      .where(and(eq(schema.channels.tenantId, tid), eq(schema.channels.isActive, true)));

    const [usage] = await db
      .select()
      .from(schema.tenantUsage)
      .where(eq(schema.tenantUsage.tenantId, tid))
      .orderBy(desc(schema.tenantUsage.recordedAt))
      .limit(1);

    const storageUsed = usage?.storageUsedGb ?? 0;

    return c.json({
      client,
      plan,
      usage: usage ?? {
        activeUsers: activeUsers.length,
        activeChannels: activeChannels.length,
        conversationsThisMonth: 0,
        storageUsedGb: storageUsed,
      },
      limits: {
        users: {
          used: activeUsers.length,
          limit: plan.maxUsers,
          percentage: Math.round((activeUsers.length / plan.maxUsers) * 100),
          warning: activeUsers.length > plan.maxUsers * 0.8,
        },
        channels: {
          used: activeChannels.length,
          limit: plan.maxChannels,
          percentage: Math.round((activeChannels.length / plan.maxChannels) * 100),
          warning: activeChannels.length > plan.maxChannels * 0.8,
        },
        storage: {
          used: storageUsed,
          limit: plan.maxStorageGb,
          percentage: Math.round((storageUsed / plan.maxStorageGb) * 100),
          warning: storageUsed > plan.maxStorageGb * 0.8,
        },
      },
    });
  });
