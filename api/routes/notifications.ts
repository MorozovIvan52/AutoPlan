import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, isNull, and, desc } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { isDemoUser } from "../lib/demo-mode";
import { forTenant } from "../lib/tenant-query";

export const notifications = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const userId = c.get("userId") as number;
    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      return c.json({ notifications: [], unread: 0 }, 200);
    }
    const all = await db.select().from(schema.notifications)
      .where(and(forTenant(schema.notifications), eq(schema.notifications.userId, userId)))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(50);
    const unread = all.filter((n) => !n.readAt).length;
    return c.json({ notifications: all, unread }, 200);
  })
  .patch("/:id/read", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    await db.update(schema.notifications).set({ readAt: new Date() }).where(
      and(
        forTenant(schema.notifications),
        eq(schema.notifications.id, id),
        eq(schema.notifications.userId, userId),
      ),
    );
    return c.json({ ok: true }, 200);
  })
  .patch("/read-all", async (c) => {
    const userId = c.get("userId") as number;
    await db.update(schema.notifications)
      .set({ readAt: new Date() })
      .where(and(
        forTenant(schema.notifications),
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      ));
    return c.json({ ok: true }, 200);
  });
