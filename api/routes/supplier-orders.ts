import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { sqlAll, sqlGet, sqlRun } from "../database/raw-sql";

type SupplierOrderRow = {
  id: number;
  tenant_id: number;
  supplier_slug: string;
  supplier_name: string;
  article: string;
  brand: string | null;
  name: string;
  qty: number;
  price: number | null;
  status: string;
  deal_id: number | null;
  external_order_id: string | null;
  notes: string | null;
  ordered_at: number | null;
  received_at: number | null;
  created_at: number;
  updated_at: number;
};

function mapOrder(r: SupplierOrderRow) {
  return {
    id: r.id,
    supplierSlug: r.supplier_slug,
    supplierName: r.supplier_name,
    article: r.article,
    brand: r.brand,
    name: r.name,
    qty: r.qty,
    price: r.price,
    status: r.status,
    dealId: r.deal_id,
    externalOrderId: r.external_order_id,
    notes: r.notes,
    orderedAt: r.ordered_at ? new Date(r.ordered_at) : null,
    receivedAt: r.received_at ? new Date(r.received_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export const supplierOrders = new Hono()
  .use("*", requireAuth)

  .get("/", async (c) => {
    const status = c.req.query("status");
    let rows = await sqlAll<SupplierOrderRow>(
      "SELECT * FROM supplier_orders WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200",
      tenantId(),
    );
    if (status) rows = rows.filter((r) => r.status === status);
    return c.json({ orders: rows.map(mapOrder) });
  })

  .post("/", async (c) => {
    const body = await c.req.json();
    const article = String(body.article || "").trim();
    const name = String(body.name || "").trim();
    if (!article || !name) return c.json({ error: "Артикул и название обязательны" }, 400);

    const now = Date.now();
    const r = await sqlRun(`
      INSERT INTO supplier_orders (
        tenant_id, supplier_slug, supplier_name, article, brand, name, qty, price,
        status, deal_id, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
    `,
      tenantId(),
      body.supplierSlug || "manual",
      body.supplierName || body.supplierSlug || "Поставщик",
      article,
      body.brand || null,
      name,
      Number(body.qty) || 1,
      body.price != null ? Number(body.price) : null,
      body.dealId ? Number(body.dealId) : null,
      body.notes || null,
      now,
      now,
    );

    const row = await sqlGet<SupplierOrderRow>("SELECT * FROM supplier_orders WHERE id = ?", r.lastInsertRowid);
    return c.json({ order: row ? mapOrder(row) : null }, 201);
  })

  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const [existing] = await sqlAll<SupplierOrderRow>(
      "SELECT * FROM supplier_orders WHERE id = ? AND tenant_id = ?",
      id, tenantId(),
    );
    if (!existing) return c.json({ error: "Не найдено" }, 404);

    const status = body.status ?? existing.status;
    const now = Date.now();
    await sqlRun(`
      UPDATE supplier_orders SET
        status = ?,
        qty = ?,
        price = ?,
        notes = ?,
        external_order_id = ?,
        ordered_at = ?,
        received_at = ?,
        updated_at = ?
      WHERE id = ? AND tenant_id = ?
    `,
      status,
      body.qty != null ? Number(body.qty) : existing.qty,
      body.price != null ? Number(body.price) : existing.price,
      body.notes !== undefined ? body.notes : existing.notes,
      body.externalOrderId !== undefined ? body.externalOrderId : existing.external_order_id,
      status === "ordered" && !existing.ordered_at ? now : existing.ordered_at,
      status === "received" ? now : existing.received_at,
      now,
      id,
      tenantId(),
    );

    const row = await sqlGet<SupplierOrderRow>("SELECT * FROM supplier_orders WHERE id = ?", id);
    return c.json({ order: row ? mapOrder(row) : null });
  })

  .delete("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    await sqlRun("DELETE FROM supplier_orders WHERE id = ? AND tenant_id = ?", id, tenantId());
    return c.json({ ok: true });
  });
