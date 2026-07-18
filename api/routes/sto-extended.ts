import { Hono } from "hono";
import { db } from "../database";
import { sqlGet, sqlAll, sqlRun } from "../database/raw-sql";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { DEFAULT_DIAGNOSTIC_CHECKLIST } from "../lib/sto-extended-bootstrap";
import { logDealAudit, getDealAuditLog, getDealNotes, addDealNote } from "../lib/sto-audit";
import {
  reserveStockForDealItem,
  releaseReserveForDealItem,
  releaseAllReservesForDeal,
  logStockMovement,
  applyMarkup,
} from "../lib/stock-reserve";
import {
  calcLaborLinePrice,
  getDefaultLaborRate,
  recalcDealTotals,
} from "../lib/deal-totals";
import { sendToClientPreferred } from "../lib/client-notify";
import { searchLaborCatalogFromDb } from "../lib/sto-labor-catalog";
import { assertDealInTenant } from "../lib/tenant-guard";
import { forTenant, tenantId } from "../lib/tenant-query";
import { buildSqlSetClauses } from "../lib/sql-ident";
import { jsonApiError } from "../lib/api-error";
import { getTenantId } from "../lib/tenant-context";

type AuthUser = { id: number; role?: string; canViewMoney?: boolean; canEditPrices?: boolean };

function getUser(c: { get: (k: string) => unknown }): AuthUser {
  return c.get("user") as AuthUser;
}

function parseCsv(text: string): string[][] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  return lines.map((line) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQ = !inQ;
        continue;
      }
      if ((ch === "," || ch === ";") && !inQ) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur.trim());
    return out;
  });
}

export const stoExtended = new Hono()
  .use("*", requireAuth)
  .use("/deals/:dealId/*", async (c, next) => {
    const dealId = parseInt(c.req.param("dealId"), 10);
    if (!Number.isFinite(dealId)) return c.json({ error: "Неверный id" }, 400);
    const check = await assertDealInTenant(dealId);
    if (!check.ok) return c.json({ error: "Заказ не найден" }, 404);
    await next();
  })

  // ── Каталог работ ─────────────────────────────────────────────────────────
  .get("/labor-catalog", async (c) => {
    const q = c.req.query("q") || "";
    const items = await searchLaborCatalogFromDb(q);
    return c.json({ items }, 200);
  })

  .get("/labor-catalog/all", async (c) => {
    const tid = getTenantId();
    const items = await sqlAll(`
      SELECT * FROM sto_labor_catalog WHERE tenant_id = ? AND is_active = 1 ORDER BY category, sort_order, name
    `, tid);
    return c.json({ items }, 200);
  })

  .post("/labor-catalog", async (c) => {
    const body = await c.req.json();
    const code = (body.code || "").trim();
    const name = (body.name || "").trim();
    if (!code || !name) return c.json({ error: "Код и название обязательны" }, 400);
    try {
      const r = await sqlRun(`
        INSERT INTO sto_labor_catalog (tenant_id, code, name, norm_hours, category, hourly_rate, is_active, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
      `, getTenantId(), code, name, Number(body.normHours) || 1, body.category || null, body.hourlyRate ?? null, body.sortOrder ?? 0, Date.now());
      return c.json({ id: r.lastInsertRowid }, 201);
    } catch {
      return c.json({ error: "Код уже существует" }, 409);
    }
  })

  .patch("/labor-catalog/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const { setClauses, values } = buildSqlSetClauses(body, {
      name: "name",
      normHours: "norm_hours",
      category: "category",
      hourlyRate: "hourly_rate",
      isActive: "is_active",
      sortOrder: "sort_order",
    });
    if (!setClauses.length) return c.json({ error: "Нет полей" }, 400);
    values.push(id, getTenantId());
    await sqlRun(`UPDATE sto_labor_catalog SET ${setClauses.join(", ")} WHERE id = ? AND tenant_id = ?`, ...values);
    return c.json({ ok: true }, 200);
  })

  .delete("/labor-catalog/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    await sqlRun("UPDATE sto_labor_catalog SET is_active = 0 WHERE id = ? AND tenant_id = ?", id, getTenantId());
    return c.json({ ok: true }, 200);
  })

  .post("/labor-catalog/import", async (c) => {
    const body = await c.req.json();
    const text = body.csv || body.text || "";
    if (!text.trim()) return c.json({ error: "Пустой файл" }, 400);
    const rows = parseCsv(text);
    const header = rows[0]?.map((h) => h.toLowerCase());
    let start = 0;
    let codeIdx = 0;
    let nameIdx = 1;
    let hoursIdx = 2;
    let catIdx = 3;
    if (header && (header.includes("код") || header.includes("code"))) {
      codeIdx = header.findIndex((h) => h.includes("код") || h === "code");
      nameIdx = header.findIndex((h) => h.includes("назв") || h === "name");
      hoursIdx = header.findIndex((h) => h.includes("норм") || h.includes("час") || h === "hours");
      catIdx = header.findIndex((h) => h.includes("катег") || h === "category");
      start = 1;
    }
    let imported = 0;
    const now = Date.now();
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      const code = row[codeIdx]?.trim();
      const name = row[nameIdx]?.trim();
      if (!code || !name) continue;
      const hours = parseFloat(row[hoursIdx]?.replace(",", ".") || "1") || 1;
      const category = catIdx >= 0 ? row[catIdx]?.trim() || null : null;
      await sqlRun(`
      INSERT INTO sto_labor_catalog (tenant_id, code, name, norm_hours, category, is_active, sort_order, created_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(tenant_id, code) DO UPDATE SET name=excluded.name, norm_hours=excluded.norm_hours, category=excluded.category
    `, getTenantId(), code, name, hours, category, i, now);
      imported++;
    }
    return c.json({ imported }, 200);
  })

  .post("/labor-catalog/reseed", async (c) => {
    const { ensureStoExtendedTables } = await import("../lib/sto-extended-bootstrap");
    await ensureStoExtendedTables();
    const items = await searchLaborCatalogFromDb("");
    return c.json({ ok: true, count: items.length }, 200);
  })

  // ── Комплексы работ ─────────────────────────────────────────────────────────
  .get("/labor-complexes", async (c) => {
    const complexes = await sqlAll<{ id: number }>(`
      SELECT * FROM sto_labor_complexes WHERE tenant_id = ? AND is_active = 1 ORDER BY category, name
    `, getTenantId());
    const items = await sqlAll<{ complex_id: number }>(
      "SELECT * FROM sto_labor_complex_items WHERE tenant_id = ? ORDER BY sort_order",
      getTenantId(),
    );
    const byComplex = new Map<number, unknown[]>();
    for (const item of items) {
      const list = byComplex.get(item.complex_id) || [];
      list.push(item);
      byComplex.set(item.complex_id, list);
    }
    return c.json({
      complexes: complexes.map((cx) => ({ ...cx, items: byComplex.get(cx.id) || [] })),
    }, 200);
  })

  .post("/deals/:dealId/apply-complex/:complexId", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const complexId = parseInt(c.req.param("complexId"));
    const user = getUser(c);
    const cxItems = await sqlAll<{ catalog_code: string | null; name: string; norm_hours: number }>(`
      SELECT * FROM sto_labor_complex_items WHERE complex_id = ? AND tenant_id = ? ORDER BY sort_order
    `, complexId, getTenantId());
    if (!cxItems.length) return c.json({ error: "Комплекс пуст" }, 404);

    const defaultRate = await getDefaultLaborRate();
    const maxSort = await sqlGet<{ m: number }>("SELECT COALESCE(MAX(sort_order),0) as m FROM deal_labor_items WHERE deal_id=?", dealId);
    const maxOrder = maxSort?.m ?? 0;

    for (let i = 0; i < cxItems.length; i++) {
      const row = cxItems[i];
      let normHours = row.norm_hours;
      let name = row.name;
      let code = row.catalog_code;
      if (code) {
        const cat = await sqlGet<{ name: string; norm_hours: number }>(
          "SELECT * FROM sto_labor_catalog WHERE code = ? AND tenant_id = ?",
          code,
          getTenantId(),
        );
        if (cat) {
          name = cat.name;
          normHours = cat.norm_hours;
        }
      }
      const price = calcLaborLinePrice({ normHours, hours: normHours, hourlyRate: defaultRate }, defaultRate);
      await db.insert(schema.dealLaborItems).values({
        dealId,
        code,
        name,
        normHours,
        hours: normHours,
        hourlyRate: defaultRate,
        price,
        sortOrder: maxOrder + i + 1,
      });
    }
    await recalcDealTotals(dealId);
    await logDealAudit(dealId, user.id, "complex_applied", `Комплекс #${complexId}`);
    return c.json({ ok: true, added: cxItems.length }, 200);
  })

  // ── Диагностический лист ────────────────────────────────────────────────────
  .get("/deals/:dealId/diagnostics", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const items = await sqlAll(`
      SELECT * FROM deal_diagnostic_items WHERE deal_id = ? ORDER BY sort_order, id
    `, dealId);
    return c.json({ items }, 200);
  })

  .post("/deals/:dealId/diagnostics/init", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const existing = await sqlGet<{ c: number }>("SELECT COUNT(*) as c FROM deal_diagnostic_items WHERE deal_id=?", dealId);
    if ((existing?.c ?? 0) > 0) return c.json({ error: "Уже инициализирован" }, 400);

    let order = 0;
    for (const group of DEFAULT_DIAGNOSTIC_CHECKLIST) {
      for (const label of group.items) {
        await sqlRun(`
      INSERT INTO deal_diagnostic_items (deal_id, group_name, label, status, sort_order)
      VALUES (?, ?, ?, 'ok', ?)
    `, dealId, group.group, label, order++);
      }
    }
    await logDealAudit(dealId, getUser(c).id, "diagnostics_init", "Создан чек-лист осмотра");
    return c.json({ ok: true, count: order }, 201);
  })

  .patch("/diagnostics/:itemId", async (c) => {
    const itemId = parseInt(c.req.param("itemId"));
    const body = await c.req.json();
    const item = await sqlGet<{ id: number; deal_id: number }>(
      "SELECT id, deal_id FROM deal_diagnostic_items WHERE id = ?",
      itemId,
    );
    if (!item) return c.json({ error: "Пункт не найден" }, 404);
    const check = await assertDealInTenant(item.deal_id);
    if (!check.ok) return c.json({ error: "ЗН не найден" }, 404);

    const { setClauses, values: setValues } = buildSqlSetClauses(body, {
      status: "status",
      note: "note",
    });
    if (!setClauses.length) return c.json({ error: "Нет полей" }, 400);
    const vals = [...setValues, itemId];
    await sqlRun(`UPDATE deal_diagnostic_items SET ${setClauses.join(", ")} WHERE id = ?`, ...vals);
    return c.json({ ok: true }, 200);
  })

  // ── История и примечания ЗН ─────────────────────────────────────────────────
  .get("/deals/:dealId/audit", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    return c.json({ items: await getDealAuditLog(dealId) }, 200);
  })

  .get("/deals/:dealId/notes", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    return c.json({ items: await getDealNotes(dealId) }, 200);
  })

  .post("/deals/:dealId/notes", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const body = await c.req.json();
    const text = (body.text || "").trim();
    if (!text) return c.json({ error: "Пустое примечание" }, 400);
    const id = await addDealNote(dealId, getUser(c).id, text);
    return c.json({ id }, 201);
  })

  // ── Согласование с клиентом ─────────────────────────────────────────────────
  .post("/deals/:dealId/request-approval", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const user = getUser(c);
    const check = await assertDealInTenant(dealId);
    if (!check.ok) return c.json({ error: "ЗН не найден" }, 404);
    const deal = check.row;

    const labor = await db.select().from(schema.dealLaborItems).where(eq(schema.dealLaborItems.dealId, dealId));
    const parts = await db.select().from(schema.orderItems).where(eq(schema.orderItems.dealId, dealId));
    const laborSum = labor.reduce((s, l) => s + (l.price || 0), 0);
    const partsSum = parts.filter((p) => p.partSource !== "client").reduce((s, p) => s + (p.price || 0) * (p.qty || 1), 0);
    const total = laborSum + partsSum;

    const lines: string[] = [
      `Здравствуйте! По вашему автомобилю подготовлен перечень работ (ЗН #${dealId}):`,
      "",
      ...labor.map((l) => `• ${l.name} — ${Math.round(l.price || 0)} ₽`),
    ];
    const visibleParts = parts.filter((p) => !(p as { embeddedInLabor?: boolean }).embeddedInLabor);
    if (visibleParts.length) {
      lines.push("", "Запчасти:");
      for (const p of visibleParts) {
        lines.push(`• ${p.name} × ${p.qty} — ${Math.round((p.price || 0) * (p.qty || 1))} ₽`);
      }
    }
    lines.push("", `Итого: ${Math.round(total)} ₽`, "", "Подтвердите, пожалуйста, согласие на выполнение работ. Ответьте «Да» или уточните вопросы.");

    await sqlRun("UPDATE deals SET client_approval_status = 'pending' WHERE id = ?", dealId);
    await sqlRun("UPDATE deal_labor_items SET approval_status = 'pending' WHERE deal_id = ?", dealId);

    let notify: { ok: boolean; channel?: string; error?: string } = { ok: false, error: undefined };
    if (deal.clientId) {
      notify = await sendToClientPreferred({
        clientId: deal.clientId,
        text: lines.join("\n"),
        preferredMessenger: "auto",
        senderId: user.id,
      });
    }

    await logDealAudit(dealId, user.id, "approval_requested", notify.ok ? "Уведомление отправлено" : notify.error || "Без канала");
    return c.json({ ok: true, notify }, 200);
  })

  .post("/deals/:dealId/approval-status", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const body = await c.req.json();
    const status = body.status as string;
    if (!["approved", "rejected", "pending"].includes(status)) {
      return c.json({ error: "Неверный статус" }, 400);
    }
    await sqlRun("UPDATE deals SET client_approval_status = ? WHERE id = ?", status, dealId);
    if (status === "approved") {
      await sqlRun("UPDATE deal_labor_items SET approval_status = 'approved' WHERE deal_id = ?", dealId);
    }
    await logDealAudit(dealId, getUser(c).id, "approval_status", status);
    return c.json({ ok: true }, 200);
  })

  // ── Резерв склада ───────────────────────────────────────────────────────────
  .post("/deals/:dealId/items/:itemId/reserve", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    const itemId = parseInt(c.req.param("itemId"));
    const body = await c.req.json();
    const stockPartId = Number(body.stockPartId);
    const qty = Number(body.qty) || 1;
    if (!stockPartId) return c.json({ error: "Укажите товар склада" }, 400);

    const row = await sqlGet<{ stock_part_id: number; reserved_qty: number }>(
      "SELECT stock_part_id, reserved_qty FROM order_items WHERE id=? AND deal_id=?",
      itemId,
      dealId,
    );
    if (!row) return c.json({ error: "Позиция не найдена" }, 404);
    if (row.stock_part_id && row.reserved_qty > 0) {
      await releaseReserveForDealItem(row.stock_part_id, row.reserved_qty, dealId);
    }
    try {
      await reserveStockForDealItem(stockPartId, qty, dealId, itemId);
      await logDealAudit(dealId, getUser(c).id, "reserve", `Резерв ${qty} шт., позиция #${itemId}`);
      return c.json({ ok: true }, 200);
    } catch (e: unknown) {
      return jsonApiError(c, e, "Ошибка резерва", 400, "sto_reserve");
    }
  })

  .post("/deals/:dealId/release-reserves", async (c) => {
    const dealId = parseInt(c.req.param("dealId"));
    await releaseAllReservesForDeal(dealId);
    await logDealAudit(dealId, getUser(c).id, "reserve_release", "Сняты все резервы");
    return c.json({ ok: true }, 200);
  })

  // ── Приходные накладные ─────────────────────────────────────────────────────
  .get("/stock-receipts", async (c) => {
    const items = await sqlAll(`
      SELECT r.*, u.name as created_by_name
      FROM stock_receipts r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.tenant_id = ?
      ORDER BY r.created_at DESC LIMIT 100
    `, getTenantId());
    return c.json({ items }, 200);
  })

  .get("/stock-receipts/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const receipt = await sqlGet("SELECT * FROM stock_receipts WHERE id=? AND tenant_id = ?", id, getTenantId());
    if (!receipt) return c.json({ error: "Не найдено" }, 404);
    const lines = await sqlAll("SELECT * FROM stock_receipt_items WHERE receipt_id=? AND tenant_id = ?", id, getTenantId());
    return c.json({ receipt, items: lines }, 200);
  })

  .post("/stock-receipts", async (c) => {
    const body = await c.req.json();
    const user = getUser(c);
    const r = await sqlRun(`
      INSERT INTO stock_receipts (tenant_id, doc_number, supplier, status, notes, created_by, created_at)
      VALUES (?, ?, ?, 'draft', ?, ?, ?)
    `, getTenantId(), body.docNumber || null, body.supplier || null, body.notes || null, user.id, Date.now());
    const receiptId = r.lastInsertRowid as number;
    let total = 0;
    for (const line of body.items || []) {
      const qty = Number(line.qty) || 1;
      const purchase = Number(line.purchasePrice) || 0;
      const sale = line.salePrice != null ? Number(line.salePrice) : applyMarkup(purchase, line.markupPercent);
      total += purchase * qty;
      await sqlRun(`
      INSERT INTO stock_receipt_items (tenant_id, receipt_id, stock_part_id, article, brand, name, qty, purchase_price, sale_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, getTenantId(), receiptId, line.stockPartId || null, line.article || null, line.brand || null, line.name, qty, purchase, sale);
    }
    await sqlRun("UPDATE stock_receipts SET total_amount = ? WHERE id = ? AND tenant_id = ?", total, receiptId, getTenantId());
    return c.json({ id: receiptId }, 201);
  })

  .post("/stock-receipts/:id/post", async (c) => {
    const id = parseInt(c.req.param("id"));
    const receipt = await sqlGet<{ status: string }>("SELECT * FROM stock_receipts WHERE id=? AND tenant_id = ?", id, getTenantId());
    if (!receipt) return c.json({ error: "Не найдено" }, 404);
    if (receipt.status === "posted") return c.json({ error: "Уже проведена" }, 400);

    const lines = await sqlAll<{
      stock_part_id: number | null;
      article: string | null;
      brand: string | null;
      name: string;
      qty: number;
      purchase_price: number;
      sale_price: number;
    }>("SELECT * FROM stock_receipt_items WHERE receipt_id=? AND tenant_id = ?", id, getTenantId());

    const settings = await sqlGet<{ default_markup_percent: number }>(
      "SELECT default_markup_percent FROM crm_settings WHERE tenant_id = ? LIMIT 1",
      getTenantId(),
    );
    const defaultMarkup = settings?.default_markup_percent ?? 30;

    for (const line of lines) {
      let partId = line.stock_part_id;
      if (!partId) {
        const r = await sqlRun(`
          INSERT INTO parts_stock (tenant_id, article, brand, name, qty, price, purchase_price, markup_percent, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
          getTenantId(),
          line.article,
          line.brand,
          line.name,
          line.qty,
          line.sale_price || applyMarkup(line.purchase_price, defaultMarkup),
          line.purchase_price,
          defaultMarkup,
          Date.now(),
        );
        partId = r.lastInsertRowid as number;
        await sqlRun(
          "UPDATE stock_receipt_items SET stock_part_id = ? WHERE receipt_id = ? AND name = ? AND tenant_id = ?",
          partId, id, line.name, getTenantId(),
        );
      } else {
        await sqlRun(`
          UPDATE parts_stock SET
            qty = COALESCE(qty,0) + ?,
            purchase_price = COALESCE(?, purchase_price),
            price = COALESCE(?, price)
          WHERE id = ? AND tenant_id = ?
        `, line.qty, line.purchase_price, line.sale_price, partId, getTenantId());
      }
      await logStockMovement(partId, line.qty, "Приходная накладная", "receipt", id);
    }

    await sqlRun("UPDATE stock_receipts SET status='posted', posted_at=? WHERE id=? AND tenant_id = ?", Date.now(), id, getTenantId());
    return c.json({ ok: true }, 200);
  })

  .post("/stock-receipts/import", async (c) => {
    const body = await c.req.json();
    const text = body.csv || body.text || "";
    if (!text.trim()) return c.json({ error: "Пустой файл" }, 400);
    const rows = parseCsv(text);
    const settings = await sqlGet<{ default_markup_percent: number }>(
      "SELECT default_markup_percent FROM crm_settings WHERE tenant_id = ? LIMIT 1",
      getTenantId(),
    );
    const defaultMarkup = settings?.default_markup_percent ?? 30;

    const user = getUser(c);
    const r = await sqlRun(`
      INSERT INTO stock_receipts (tenant_id, doc_number, supplier, status, notes, created_by, created_at)
      VALUES (?, ?, ?, 'draft', 'Импорт CSV', ?, ?)
    `, getTenantId(), body.docNumber || `IMP-${Date.now()}`, body.supplier || null, user.id, Date.now());
    const receiptId = r.lastInsertRowid as number;

    let start = 0;
    const header = rows[0]?.map((h) => h.toLowerCase()) || [];
    if (header.some((h) => h.includes("артикул") || h === "article")) start = 1;

    const findCol = (keys: string[]) => header.findIndex((h) => keys.some((k) => h.includes(k)));

    const artIdx = findCol(["артикул", "article"]) >= 0 ? findCol(["артикул", "article"]) : 0;
    const brandIdx = findCol(["бренд", "brand"]) >= 0 ? findCol(["бренд", "brand"]) : 1;
    const nameIdx = findCol(["назв", "name"]) >= 0 ? findCol(["назв", "name"]) : 2;
    const qtyIdx = findCol(["кол", "qty"]) >= 0 ? findCol(["кол", "qty"]) : 3;
    const purchaseIdx = findCol(["закуп", "purchase", "себест"]) >= 0 ? findCol(["закуп", "purchase", "себест"]) : 4;

    let total = 0;
    let count = 0;
    for (let i = start; i < rows.length; i++) {
      const row = rows[i];
      const name = row[nameIdx]?.trim();
      if (!name) continue;
      const qty = parseInt(row[qtyIdx] || "1", 10) || 1;
      const purchase = parseFloat((row[purchaseIdx] || "0").replace(",", ".")) || 0;
      const sale = applyMarkup(purchase, defaultMarkup);
      total += purchase * qty;
      await sqlRun(`
      INSERT INTO stock_receipt_items (tenant_id, receipt_id, article, brand, name, qty, purchase_price, sale_price)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, getTenantId(), receiptId, row[artIdx] || null, row[brandIdx] || null, name, qty, purchase, sale);
      count++;
    }
    await sqlRun("UPDATE stock_receipts SET total_amount = ? WHERE id = ? AND tenant_id = ?", total, receiptId, getTenantId());
    return c.json({ id: receiptId, lines: count }, 201);
  })

  .get("/stock-movements", async (c) => {
    const partId = c.req.query("partId");
    const items = partId
      ? await sqlAll("SELECT * FROM stock_movements WHERE part_id=? AND tenant_id = ? ORDER BY created_at DESC LIMIT 200", partId, getTenantId())
      : await sqlAll("SELECT * FROM stock_movements WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 200", getTenantId());
    return c.json({ items }, 200);
  })

  // ── Авансы ────────────────────────────────────────────────────────────────────
  .get("/advances", async (c) => {
    const clientId = c.req.query("clientId");
    const items = clientId
      ? await sqlAll("SELECT * FROM client_advances WHERE client_id=? AND tenant_id = ? ORDER BY created_at DESC", clientId, getTenantId())
      : await sqlAll(`
          SELECT a.*, c.name as client_name FROM client_advances a
          LEFT JOIN clients c ON c.id = a.client_id
          WHERE a.tenant_id = ?
          ORDER BY a.created_at DESC LIMIT 100
        `, getTenantId());
    return c.json({ items }, 200);
  })

  .post("/advances", async (c) => {
    const body = await c.req.json();
    const clientId = Number(body.clientId);
    const amount = Number(body.amount);
    if (!clientId || amount <= 0) return c.json({ error: "Клиент и сумма обязательны" }, 400);
    const r = await sqlRun(`
      INSERT INTO client_advances (tenant_id, client_id, amount, balance, payment_method, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, getTenantId(), clientId, amount, amount, body.paymentMethod || null, body.notes || null, Date.now());
    return c.json({ id: r.lastInsertRowid }, 201);
  })

  .post("/advances/:id/allocate", async (c) => {
    const advanceId = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const amount = Number(body.amount);
    const dealId = body.dealId ? Number(body.dealId) : null;
    if (amount <= 0) return c.json({ error: "Сумма обязательна" }, 400);

    const adv = await sqlGet<{ balance: number }>(
      "SELECT * FROM client_advances WHERE id=? AND tenant_id = ?",
      advanceId,
      getTenantId(),
    );
    if (!adv || adv.balance < amount) return c.json({ error: "Недостаточно аванса" }, 400);

    await sqlRun("UPDATE client_advances SET balance = balance - ? WHERE id = ? AND tenant_id = ?", amount, advanceId, getTenantId());
    await sqlRun(`
      INSERT INTO advance_allocations (tenant_id, advance_id, deal_id, sales_doc_id, amount, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `, getTenantId(), advanceId, dealId, body.salesDocId || null, amount, Date.now());

    if (dealId) await logDealAudit(dealId, getUser(c).id, "advance_allocated", `${amount} ₽`);
    return c.json({ ok: true }, 200);
  })

  // ── Отчёты СТО ──────────────────────────────────────────────────────────────
  .get("/reports/margin", async (c) => {
    const user = getUser(c);
    if (user.canViewMoney === false) return c.json({ error: "Нет доступа к финансам" }, 403);

    const rows = await sqlAll<{
      id: number;
      amount: number;
      parts_cost: number;
      labor_cost: number;
    }>(`
      SELECT d.id, d.title, d.amount, d.parts_cost, d.labor_cost, d.status, d.created_at,
             c.name as client_name
      FROM deals d
      LEFT JOIN clients c ON c.id = d.client_id
      WHERE d.tenant_id = ?
        AND (d.appointment_id IS NOT NULL OR d.wo_enterprise_id IS NOT NULL)
      ORDER BY d.created_at DESC
      LIMIT 200
    `, getTenantId());

    const items = rows.map((r) => {
      const revenue = r.amount || 0;
      const cost = r.parts_cost || 0;
      const margin = revenue - cost;
      const marginPct = revenue > 0 ? Math.round((margin / revenue) * 1000) / 10 : 0;
      return { ...r, revenue, cost, margin, marginPct };
    });
    return c.json({ items }, 200);
  })

  .get("/reports/client-debts", async (c) => {
    const user = getUser(c);
    if (user.canViewMoney === false) return c.json({ error: "Нет доступа" }, 403);

    const items = await sqlAll<{ id: number; name: string; total_wo: number; total_paid: number }>(`
      SELECT c.id, c.name, c.phone,
             COALESCE(SUM(d.amount), 0) as total_wo,
             COALESCE(SUM(CASE WHEN sd.status = 'posted' THEN COALESCE(sd.payment_amount, sd.total_amount, 0) ELSE 0 END), 0) as total_paid
      FROM clients c
      INNER JOIN deals d ON d.client_id = c.id
      LEFT JOIN sales_documents sd ON sd.deal_id = d.id
      WHERE c.tenant_id = ?
        AND d.tenant_id = ?
        AND (sd.id IS NULL OR sd.tenant_id = ?)
        AND d.status NOT IN ('cancelled', 'lost')
      GROUP BY c.id
      HAVING total_wo > total_paid
      ORDER BY (total_wo - total_paid) DESC
      LIMIT 100
    `, getTenantId(), getTenantId(), getTenantId());

    return c.json({
      items: items.map((i) => ({
        ...i,
        debt: Math.round((i.total_wo - i.total_paid) * 100) / 100,
      })),
    }, 200);
  })

  // ── Канбан дня СТО ──────────────────────────────────────────────────────────
  .get("/day-board", async (c) => {
    const date = c.req.query("date") || new Date().toISOString().slice(0, 10);
    const dayStart = new Date(`${date}T00:00:00`).getTime();
    const dayEnd = dayStart + 86400000;
    const statusFilter = (c.req.query("status") || "").trim();
    const assignedToRaw = c.req.query("assignedTo");
    const assignedTo = assignedToRaw ? parseInt(assignedToRaw, 10) : null;
    const enterpriseIdRaw = c.req.query("enterpriseId");
    const enterpriseId = enterpriseIdRaw ? parseInt(enterpriseIdRaw, 10) : null;
    const openOnly = c.req.query("openOnly") !== "0";

    const params: unknown[] = [getTenantId()];
    let sql = `
      SELECT d.*, c.name as client_name,
        COALESCE(v.plate, d.vehicle_plate) as vehicle_plate,
        COALESCE(v.make, d.vehicle_make) as vehicle_brand,
        COALESCE(v.model, d.vehicle_model) as vehicle_model,
        COALESCE(d.amount, 0) - COALESCE(d.paid_amount, 0) as debt
      FROM deals d
      LEFT JOIN clients c ON c.id = d.client_id
      LEFT JOIN vehicles v ON v.id = d.vehicle_id
      WHERE d.tenant_id = ?
        AND d.order_type = 'service'
    `;

    if (openOnly) {
      // открытые + обновлённые/созданные в выбранный день, либо все открытые без жёсткой привязки к created
      sql += ` AND (
        d.status NOT IN ('done', 'cancelled', 'shipped')
        OR (d.updated_at >= ? AND d.updated_at < ?)
        OR (d.created_at >= ? AND d.created_at < ?)
      )`;
      params.push(dayStart, dayEnd, dayStart, dayEnd);
    } else {
      sql += ` AND (
        (d.updated_at >= ? AND d.updated_at < ?)
        OR (d.created_at >= ? AND d.created_at < ?)
      )`;
      params.push(dayStart, dayEnd, dayStart, dayEnd);
    }

    if (statusFilter) {
      sql += ` AND d.status = ?`;
      params.push(statusFilter);
    }
    if (assignedTo && Number.isFinite(assignedTo)) {
      sql += ` AND d.assigned_to = ?`;
      params.push(assignedTo);
    }
    if (enterpriseId && Number.isFinite(enterpriseId)) {
      sql += ` AND d.wo_enterprise_id = ?`;
      params.push(enterpriseId);
    }

    sql += ` ORDER BY d.updated_at DESC, d.created_at DESC LIMIT 300`;

    const deals = await sqlAll(sql, ...params);

    const columns: Record<string, unknown[]> = {
      queue: [],
      waiting_parts: [],
      on_lift: [],
      in_progress: [],
      qc: [],
      ready: [],
      waiting_approval: [],
      done: [],
    };
    for (const deal of deals as {
      status: string;
      client_approval_status?: string;
      payment_status?: string;
      paid_amount?: number;
      amount?: number;
      debt?: number;
    }[]) {
      const card = {
        ...deal,
        paymentStatus: deal.payment_status || "unpaid",
        paidAmount: deal.paid_amount ?? 0,
        debt: Math.max(0, Number(deal.debt) || 0),
      };
      if (deal.client_approval_status === "pending") {
        columns.waiting_approval.push(card);
      } else if (deal.status === "done" || deal.status === "cancelled" || deal.status === "shipped") {
        columns.done.push(card);
      } else if (deal.status === "waiting_parts") {
        columns.waiting_parts.push(card);
      } else if (deal.status === "on_lift") {
        columns.on_lift.push(card);
      } else if (deal.status === "qc") {
        columns.qc.push(card);
      } else if (deal.status === "ready") {
        columns.ready.push(card);
      } else if (deal.status === "in_progress") {
        columns.in_progress.push(card);
      } else {
        columns.queue.push(card);
      }
    }
    return c.json({
      date,
      columns,
      filters: {
        status: statusFilter || null,
        assignedTo: assignedTo && Number.isFinite(assignedTo) ? assignedTo : null,
        enterpriseId: enterpriseId && Number.isFinite(enterpriseId) ? enterpriseId : null,
        openOnly,
      },
    }, 200);
  })

  // ── Закрыть ЗН с оплатой / доплата ──────────────────────────────────────────
  .post("/deals/:dealId/close-with-payment", async (c) => {
    const dealId = parseInt(c.req.param("dealId"), 10);
    const user = getUser(c);
    const body = await c.req.json().catch(() => ({})) as {
      paymentAmount?: number;
      paymentMethod?: string;
      setStatusDone?: boolean;
      allowPartial?: boolean;
    };
    const method = body.paymentMethod === "card" || body.paymentMethod === "transfer"
      ? body.paymentMethod
      : "cash";
    try {
      const { closeDealWithPayment, CloseDealError } = await import("../lib/close-deal-with-payment");
      const result = await closeDealWithPayment({
        dealId,
        userId: user.id,
        paymentAmount: Number(body.paymentAmount),
        paymentMethod: method,
        setStatusDone: body.setStatusDone !== false,
        allowPartial: body.allowPartial !== false,
        closeDeal: true,
      });
      await logDealAudit(
        dealId,
        user.id,
        "close_payment",
        `Оплата ${body.paymentAmount} (${method}), статус ${result.deal.paymentStatus}, долг ${result.debt}`,
      );
      return c.json(result, 200);
    } catch (e: unknown) {
      return jsonApiError(c, e, "Ошибка закрытия", 500, "sto_close_payment");
    }
  })

  .post("/deals/:dealId/payments", async (c) => {
    const dealId = parseInt(c.req.param("dealId"), 10);
    const user = getUser(c);
    const body = await c.req.json().catch(() => ({})) as {
      paymentAmount?: number;
      paymentMethod?: string;
    };
    const method = body.paymentMethod === "card" || body.paymentMethod === "transfer"
      ? body.paymentMethod
      : "cash";
    try {
      const { closeDealWithPayment, CloseDealError } = await import("../lib/close-deal-with-payment");
      const result = await closeDealWithPayment({
        dealId,
        userId: user.id,
        paymentAmount: Number(body.paymentAmount),
        paymentMethod: method,
        setStatusDone: false,
        allowPartial: true,
        closeDeal: false,
      });
      await logDealAudit(dealId, user.id, "payment", `Доплата ${body.paymentAmount} (${method})`);
      return c.json(result, 200);
    } catch (e: unknown) {
      return jsonApiError(c, e, "Ошибка оплаты", 500, "sto_payment");
    }
  })

  // ── Дашборд владельца СТО ───────────────────────────────────────────────────
  .get("/owner-dashboard", async (c) => {
    const user = getUser(c);
    if (user.role !== "admin" && user.role !== "operator") {
      return c.json({ error: "Недостаточно прав" }, 403);
    }
    const { getOwnerDashboardMetrics } = await import("../lib/owner-dashboard");
    const metrics = await getOwnerDashboardMetrics();
    return c.json({ metrics }, 200);
  })

  // ── PWA Мастер ──────────────────────────────────────────────────────────────
  .get("/master/deals", async (c) => {
    const user = getUser(c);
    const { listMasterDeals, parseDefectPhotos, getActiveWorkSession } = await import("../lib/master-work");
    const deals = await listMasterDeals(user.id);
    const enriched = await Promise.all(deals.map(async (d) => {
      const session = await getActiveWorkSession(d.id, user.id);
      return {
        ...d,
        defectPhotos: parseDefectPhotos(d.defectPhotos),
        activeSession: session
          ? { id: session.id, startedAt: session.startedAt }
          : null,
      };
    }));
    return c.json({ deals: enriched }, 200);
  })

  .post("/deals/:dealId/work-sessions", async (c) => {
    const user = getUser(c);
    const dealId = parseInt(c.req.param("dealId"), 10);
    const { startWorkSession } = await import("../lib/master-work");
    const session = await startWorkSession(dealId, user.id);
    return c.json({ session }, 201);
  })

  .patch("/deals/:dealId/work-sessions", async (c) => {
    const user = getUser(c);
    const dealId = parseInt(c.req.param("dealId"), 10);
    const { stopWorkSession } = await import("../lib/master-work");
    const session = await stopWorkSession(dealId, user.id);
    if (!session) return c.json({ error: "Активная сессия не найдена" }, 404);
    return c.json({ session }, 200);
  })

  .patch("/deals/:dealId/work-sessions/:sessionId", async (c) => {
    const user = getUser(c);
    const dealId = parseInt(c.req.param("dealId"), 10);
    const sessionId = parseInt(c.req.param("sessionId"), 10);
    const { stopWorkSession } = await import("../lib/master-work");
    const session = await stopWorkSession(dealId, user.id, Number.isFinite(sessionId) ? sessionId : undefined);
    if (!session) return c.json({ error: "Активная сессия не найдена" }, 404);
    return c.json({ session }, 200);
  })

  .post("/deals/:dealId/defect-photos", async (c) => {
    const user = getUser(c);
    const dealId = parseInt(c.req.param("dealId"), 10);
    const body = await c.req.json().catch(() => ({})) as { url?: string };
    const url = (body.url || "").trim();
    if (!url) return c.json({ error: "Укажите url фото" }, 400);
    const { appendDefectPhoto, parseDefectPhotos } = await import("../lib/master-work");
    const deal = await appendDefectPhoto(dealId, user.id, url);
    if (!deal) return c.json({ error: "ЗН не найден" }, 404);
    return c.json({ defectPhotos: parseDefectPhotos(deal.defectPhotos) }, 200);
  });
