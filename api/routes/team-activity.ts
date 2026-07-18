import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, gte, lt, desc } from "drizzle-orm";
import { requireAdmin } from "../middleware/auth";
import { buildDailyUserActivity } from "../lib/activity-track";
import { getUserInTenant } from "../lib/tenant-guard";
import { moscowDateKey, moscowDayBounds } from "../lib/moscow-time";

export const teamActivity = new Hono()
  .use("*", requireAdmin)
  .get("/", async (c) => {
    const date = c.req.query("date") || moscowDateKey();
    const users = await buildDailyUserActivity(date);
    const activeCount = users.filter((u) => u.hasActivity).length;
    return c.json({ date, users, activeCount, totalCount: users.length }, 200);
  })
  .get("/events/:userId", async (c) => {
    const userId = parseInt(c.req.param("userId"), 10);
    if (!Number.isFinite(userId)) return c.json({ error: "Некорректный userId" }, 400);
    const targetUser = await getUserInTenant(userId);
    if (!targetUser) return c.json({ error: "Not found" }, 404);

    const date = c.req.query("date") || moscowDateKey();
    const { start, end } = moscowDayBounds(date);

    const events = await db.select().from(schema.userActivityEvents).where(
      and(
        eq(schema.userActivityEvents.userId, userId),
        gte(schema.userActivityEvents.createdAt, start),
        lt(schema.userActivityEvents.createdAt, end),
      ),
    ).orderBy(desc(schema.userActivityEvents.createdAt));

    return c.json({ events }, 200);
  });
