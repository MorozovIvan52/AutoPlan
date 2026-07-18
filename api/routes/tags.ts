import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";

export const tags = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const all = await db.select().from(schema.tags)
      .where(forTenant(schema.tags))
      .orderBy(schema.tags.name);
    return c.json({ tags: all }, 200);
  })
  .post("/", async (c) => {
    const { name, color } = await c.req.json();
    const [tag] = await db.insert(schema.tags).values({ name, color, tenantId: tenantId() }).returning();
    return c.json({ tag }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const [tag] = await db.update(schema.tags).set(body)
      .where(withTenant(schema.tags, eq(schema.tags.id, id)))
      .returning();
    if (!tag) return c.json({ error: "Not found" }, 404);
    return c.json({ tag }, 200);
  })
  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    await db.delete(schema.tags).where(withTenant(schema.tags, eq(schema.tags.id, id)));
    return c.json({ ok: true }, 200);
  });
