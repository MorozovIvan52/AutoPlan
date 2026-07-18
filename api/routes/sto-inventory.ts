import { Hono } from "hono";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { sqlAll, sqlGet, sqlRun } from "../database/raw-sql";
import { tenantId, withTenant } from "../lib/tenant-query";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";

type InvSession = {
  id: number;
  tenant_id: number;
  title: string;
  status: string;
  created_by: number | null;
  completed_at: number | null;
  created_at: number;
};

type InvLine = {
  id: number;
  session_id: number;
  part_id: number | null;
  article: string;
  brand: string | null;
  name: string | null;
  expected_qty: number;
  counted_qty: number | null;
  location: string | null;
};

export const stoInventory = new Hono()
  .use("*", requireAuth)

  .get("/sessions", async (c) => {
    const rows = await sqlAll<InvSession>(
      "SELECT * FROM stock_inventory_sessions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50",
      tenantId(),
    );
    return c.json({ sessions: rows });
  })

  .post("/sessions", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const title = String(body.title || `Инвентаризация ${new Date().toLocaleDateString("ru-RU")}`).trim();
    const userId = c.get("userId") as number;
    const now = Date.now();
    const r = await sqlRun(
      "INSERT INTO stock_inventory_sessions (tenant_id, title, status, created_by, created_at) VALUES (?, ?, 'draft', ?, ?)",
      tenantId(), title, userId, now,
    );
    const parts = await db.select().from(schema.partsStock).where(eq(schema.partsStock.tenantId, tenantId()));
    const sessionId = Number(r.lastInsertRowid);
    for (const p of parts) {
      await sqlRun(
        `INSERT INTO stock_inventory_lines (session_id, part_id, article, brand, name, expected_qty, location)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        sessionId, p.id, p.article, p.brand, p.name, p.qty || 0, p.location,
      );
    }
    const session = await sqlGet<InvSession>("SELECT * FROM stock_inventory_sessions WHERE id = ?", sessionId);
    const lines = await sqlAll<InvLine>("SELECT * FROM stock_inventory_lines WHERE session_id = ?", sessionId);
    return c.json({ session, lines }, 201);
  })

  .get("/sessions/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const session = await sqlGet<InvSession>(
      "SELECT * FROM stock_inventory_sessions WHERE id = ? AND tenant_id = ?",
      id, tenantId(),
    );
    if (!session) return c.json({ error: "Не найдено" }, 404);
    const lines = await sqlAll<InvLine>("SELECT * FROM stock_inventory_lines WHERE session_id = ?", id);
    return c.json({ session, lines });
  })

  .patch("/sessions/:id/lines/:lineId", async (c) => {
    const sessionId = parseInt(c.req.param("id"));
    const lineId = parseInt(c.req.param("lineId"));
    const body = await c.req.json();
    const counted = body.countedQty != null ? Number(body.countedQty) : null;
    if (counted == null || counted < 0) return c.json({ error: "Укажите countedQty" }, 400);

    const session = await sqlGet<InvSession>(
      "SELECT * FROM stock_inventory_sessions WHERE id = ? AND tenant_id = ? AND status = 'draft'",
      sessionId, tenantId(),
    );
    if (!session) return c.json({ error: "Сессия не найдена или уже завершена" }, 404);

    await sqlRun(
      "UPDATE stock_inventory_lines SET counted_qty = ? WHERE id = ? AND session_id = ?",
      counted, lineId, sessionId,
    );
    const line = await sqlGet<InvLine>("SELECT * FROM stock_inventory_lines WHERE id = ?", lineId);
    return c.json({ line });
  })

  .post("/sessions/:id/complete", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    const session = await sqlGet<InvSession>(
      "SELECT * FROM stock_inventory_sessions WHERE id = ? AND tenant_id = ? AND status = 'draft'",
      id, tenantId(),
    );
    if (!session) return c.json({ error: "Сессия не найдена" }, 404);

    const lines = await sqlAll<InvLine>(
      "SELECT * FROM stock_inventory_lines WHERE session_id = ? AND counted_qty IS NOT NULL",
      id,
    );

    let adjusted = 0;
    for (const line of lines) {
      if (line.part_id == null || line.counted_qty == null) continue;
      if (line.counted_qty === line.expected_qty) continue;
      await db.update(schema.partsStock).set({ qty: line.counted_qty, updatedAt: new Date() })
        .where(withTenant(schema.partsStock, eq(schema.partsStock.id, line.part_id)));
      adjusted++;
    }

    await sqlRun(
      "UPDATE stock_inventory_sessions SET status = 'completed', completed_at = ? WHERE id = ?",
      Date.now(), id,
    );
    return c.json({ ok: true, adjusted, totalLines: lines.length });
  });
