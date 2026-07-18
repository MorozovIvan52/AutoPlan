import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { searchProcurement } from "../lib/procurement";

export const procurement = new Hono()
  .use("*", requireAuth)

  .get("/search", async (c) => {
    const article = (c.req.query("article") || c.req.query("q") || "").trim();
    const brand = (c.req.query("brand") || "").trim() || undefined;
    if (!article) return c.json({ error: "Укажите артикул" }, 400);
    const result = await searchProcurement(article, brand);
    return c.json(result, 200);
  });
