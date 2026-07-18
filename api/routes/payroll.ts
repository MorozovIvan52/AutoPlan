import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and, isNull } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import {
  buildPersonalPayrollReport,
  PAYROLL_SOURCE_LABELS,
} from "../lib/payroll-calc";
import { ensurePayrollTables, ensureManagerPayrollDefaults } from "../lib/db-bootstrap";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getUserInTenant } from "../lib/tenant-guard";

const adminOnly = requireAdmin;

export const payroll = new Hono()
  .use("*", requireAuth)

  /** Личный просмотр ЗП — любой авторизованный сотрудник */
  .get("/my", async (c) => {
    const userId = c.get("userId") as number;
    const today = new Date().toISOString().slice(0, 10);
    const from = c.req.query("from") || today;
    const to = c.req.query("to") || from;

    const report = await buildPersonalPayrollReport(userId, from, to);
    if (!report) return c.json({ error: "Пользователь не найден" }, 404);
    return c.json({ report }, 200);
  })

  .get("/roles", adminOnly, async (c) => {
    let roles = await db.select().from(schema.payrollRoles).where(forTenant(schema.payrollRoles)).orderBy(schema.payrollRoles.sortOrder);
    if (roles.length === 0) {
      await ensurePayrollTables();
      await ensureManagerPayrollDefaults();
      roles = await db.select().from(schema.payrollRoles).where(forTenant(schema.payrollRoles)).orderBy(schema.payrollRoles.sortOrder);
    }
    return c.json({ roles }, 200);
  })

  .post("/seed-defaults", adminOnly, async (c) => {
    await ensurePayrollTables();
    await ensureManagerPayrollDefaults();
    const roles = await db.select().from(schema.payrollRoles).where(forTenant(schema.payrollRoles)).orderBy(schema.payrollRoles.sortOrder);
    return c.json({ ok: true, roles }, 200);
  })

  .post("/roles", adminOnly, async (c) => {
    const body = await c.req.json();
    const name = (body.name || "").trim();
    const slug = (body.slug || name.toLowerCase().replace(/\s+/g, "_")).trim();
    if (!name || !slug) return c.json({ error: "Укажите название" }, 400);
    const [role] = await db.insert(schema.payrollRoles).values({ name, slug, sortOrder: body.sortOrder ?? 99, tenantId: tenantId() }).returning();
    return c.json({ role }, 201);
  })

  .patch("/roles/:id", adminOnly, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json();
    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = String(body.name).trim();
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    const [role] = await db.update(schema.payrollRoles).set(patch)
      .where(withTenant(schema.payrollRoles, eq(schema.payrollRoles.id, id))).returning();
    return c.json({ role }, 200);
  })

  .get("/rules", adminOnly, async (c) => {
    const roleId = c.req.query("roleId");
    const userId = c.req.query("userId");
    let rules = await db.select().from(schema.payrollRules).where(forTenant(schema.payrollRules)).orderBy(schema.payrollRules.sortOrder);
    if (roleId) rules = rules.filter((r) => r.roleId === parseInt(roleId, 10));
    if (userId) rules = rules.filter((r) => r.userId === parseInt(userId, 10));
    return c.json({ rules, sourceLabels: PAYROLL_SOURCE_LABELS }, 200);
  })

  .post("/rules", adminOnly, async (c) => {
    const body = await c.req.json();
    if (!body.sourceType) return c.json({ error: "Укажите источник" }, 400);
    const [rule] = await db.insert(schema.payrollRules).values({
      tenantId: tenantId(),
      roleId: body.roleId || null,
      userId: body.userId || null,
      sourceType: body.sourceType,
      calcType: body.calcType || (body.sourceType === "daily_shift" ? "fixed" : "percent"),
      value: Number(body.value) || 0,
      label: body.label?.trim() || PAYROLL_SOURCE_LABELS[body.sourceType] || body.sourceType,
      sortOrder: body.sortOrder ?? 0,
    }).returning();
    return c.json({ rule }, 201);
  })

  .patch("/rules/:id", adminOnly, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const body = await c.req.json();
    const patch: Record<string, unknown> = {};
    if (body.value != null) patch.value = Number(body.value);
    if (body.calcType !== undefined) patch.calcType = body.calcType;
    if (body.label !== undefined) patch.label = String(body.label).trim();
    if (body.isActive !== undefined) patch.isActive = body.isActive;
    if (body.sortOrder !== undefined) patch.sortOrder = body.sortOrder;
    const [rule] = await db.update(schema.payrollRules).set(patch)
      .where(withTenant(schema.payrollRules, eq(schema.payrollRules.id, id))).returning();
    return c.json({ rule }, 200);
  })

  /** Пакетное сохранение ставок должности — сразу для расчёта ЗП */
  .put("/roles/:id/rates", adminOnly, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);
    const [role] = await db.select().from(schema.payrollRoles)
      .where(withTenant(schema.payrollRoles, eq(schema.payrollRoles.id, id)));
    if (!role) return c.json({ error: "Должность не найдена" }, 404);

    const body = await c.req.json() as {
      name?: string;
      rules?: Array<{ id: number; value: number }>;
    };

    if (body.name != null) {
      const name = String(body.name).trim();
      if (name && name !== role.name) {
        await db.update(schema.payrollRoles).set({ name })
          .where(withTenant(schema.payrollRoles, eq(schema.payrollRoles.id, id)));
      }
    }

    const updated: number[] = [];
    for (const item of body.rules || []) {
      const ruleId = Number(item.id);
      const value = Number(item.value);
      if (!Number.isFinite(ruleId) || !Number.isFinite(value)) continue;
      const [rule] = await db.select().from(schema.payrollRules).where(
        withTenant(schema.payrollRules, eq(schema.payrollRules.id, ruleId), eq(schema.payrollRules.roleId, id)),
      );
      if (!rule) continue;
      await db.update(schema.payrollRules).set({ value })
        .where(withTenant(schema.payrollRules, eq(schema.payrollRules.id, ruleId)));
      updated.push(ruleId);
    }

    const rules = await db.select().from(schema.payrollRules).where(
      withTenant(schema.payrollRules, eq(schema.payrollRules.roleId, id)),
    ).orderBy(schema.payrollRules.sortOrder);
    const [fresh] = await db.select().from(schema.payrollRoles)
      .where(withTenant(schema.payrollRoles, eq(schema.payrollRoles.id, id)));

    return c.json({
      ok: true,
      role: fresh,
      rules,
      updatedCount: updated.length,
      message: "Ставки сохранены и используются в расчёте ЗП",
    }, 200);
  })

  .delete("/rules/:id", adminOnly, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    await db.delete(schema.payrollRules).where(withTenant(schema.payrollRules, eq(schema.payrollRules.id, id)));
    return c.json({ ok: true }, 200);
  })

  .post("/calculate", adminOnly, async (c) => {
    const adminId = c.get("userId") as number;
    const body = await c.req.json();
    const userId = Number(body.userId);
    if (!userId) return c.json({ error: "Укажите сотрудника" }, 400);

    const fromStr = body.periodStart?.slice(0, 10) || `${body.periodMonth}-01`;
    let toStr = body.periodEnd?.slice(0, 10);
    if (!toStr && body.periodMonth) {
      const [y, m] = String(body.periodMonth).split("-").map(Number);
      toStr = new Date(y, m, 0).toISOString().slice(0, 10);
    }
    if (!toStr) toStr = fromStr;

    const roleOverride = body.roleId ? Number(body.roleId) : undefined;

    const user = await getUserInTenant(userId);
    if (!user) return c.json({ error: "Сотрудник не найден" }, 404);

    const report = await buildPersonalPayrollReport(userId, fromStr, toStr, {
      roleIdOverride: roleOverride ?? user.payrollRoleId,
    });
    if (!report) return c.json({ error: "Ошибка расчёта" }, 500);

    const adjustments = Array.isArray(body.adjustments) ? body.adjustments : [];
    const adjTotal = adjustments.reduce((s: number, a: { amount?: number }) => s + (Number(a.amount) || 0), 0);
    const totalAmount = Math.round((report.periodTotal + adjTotal) * 100) / 100;

    if (!body.save) {
      return c.json({
        report,
        lines: report.days.flatMap((d) => d.lines),
        adjustments,
        totalAmount,
        userName: user.name,
        preview: true,
      }, 200);
    }

    const periodStart = new Date(`${fromStr}T00:00:00`);
    const periodEnd = new Date(`${toStr}T00:00:00`);
    periodEnd.setDate(periodEnd.getDate() + 1);

    const [calc] = await db.insert(schema.payrollCalculations).values({
      tenantId: tenantId(),
      userId,
      roleId: roleOverride ?? user.payrollRoleId,
      periodStart,
      periodEnd,
      status: body.finalize ? "finalized" : "draft",
      totalAmount,
      adjustments: adjustments.length ? JSON.stringify(adjustments) : null,
      notes: body.notes?.trim() || null,
      createdBy: adminId,
    }).returning();

    for (const day of report.days) {
      if (day.shiftPay > 0) {
        await db.insert(schema.payrollCalculationLines).values({
          calculationId: calc.id,
          sourceType: "daily_shift",
          sourceLabel: day.date,
          baseAmount: day.shiftPay,
          fixedAmount: day.shiftPay,
          amount: day.shiftPay,
        });
      }
      for (const line of day.lines) {
        await db.insert(schema.payrollCalculationLines).values({
          calculationId: calc.id,
          sourceType: line.sourceType,
          sourceId: line.sourceId,
          sourceLabel: line.sourceLabel,
          baseAmount: line.baseAmount,
          percent: line.percent,
          fixedAmount: line.fixedAmount,
          amount: line.amount,
          ruleId: line.ruleId,
        });
      }
    }

    const savedLines = await db.select().from(schema.payrollCalculationLines)
      .where(eq(schema.payrollCalculationLines.calculationId, calc.id));

    return c.json({ calculation: calc, lines: savedLines, adjustments, report }, 200);
  })

  .get("/calculations", adminOnly, async (c) => {
    const userId = c.req.query("userId");
    let rows = await db.select().from(schema.payrollCalculations).where(forTenant(schema.payrollCalculations)).orderBy(desc(schema.payrollCalculations.createdAt));
    if (userId) rows = rows.filter((r) => r.userId === parseInt(userId, 10));
    return c.json({ calculations: rows }, 200);
  })

  .get("/calculations/:id", adminOnly, async (c) => {
    const id = parseInt(c.req.param("id"), 10);
    const [calc] = await db.select().from(schema.payrollCalculations)
      .where(withTenant(schema.payrollCalculations, eq(schema.payrollCalculations.id, id)));
    if (!calc) return c.json({ error: "Не найдено" }, 404);
    const lines = await db.select().from(schema.payrollCalculationLines)
      .where(eq(schema.payrollCalculationLines.calculationId, id));
    const [user] = await db.select().from(schema.users)
      .where(withTenant(schema.users, eq(schema.users.id, calc.userId)));
    return c.json({
      calculation: calc,
      lines,
      adjustments: calc.adjustments ? JSON.parse(calc.adjustments) : [],
      userName: user?.name,
    }, 200);
  })

  .post("/preview", adminOnly, async (c) => {
    const body = await c.req.json();
    const userId = Number(body.userId);
    const fromStr = body.periodStart?.slice(0, 10);
    const toStr = body.periodEnd?.slice(0, 10) || fromStr;
    const user = await getUserInTenant(userId);
    if (!user) return c.json({ error: "Пользователь не найден" }, 404);
    const report = await buildPersonalPayrollReport(userId, fromStr, toStr);
    return c.json({ report, totalAmount: report?.periodTotal ?? 0 }, 200);
  });
