import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { fetchAvitoCpaStatus, checkAvitoCpaAdvance } from "../services/avito-cpa-monitor";

export const avito = new Hono()
  .use("*", requireAuth)
  .get("/cpa-status", async (c) => c.json(await fetchAvitoCpaStatus(), 200))
  .post("/cpa-check", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);
    const status = await checkAvitoCpaAdvance(true);
    return c.json(status, 200);
  });
