import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { hashPassword, validatePasswordStrength } from "../lib/password";
import { revokeUserSessions, safeUser } from "../lib/session";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getUserInTenant } from "../lib/tenant-guard";
import { canCreateMoreUsers, getTenantById } from "../lib/tenant";
import { canCreateUser } from "../lib/quota-enforcement";

async function countActiveAdmins(excludeId?: number): Promise<number> {
  const rows = await db.select({ id: schema.users.id })
    .from(schema.users)
    .where(and(
      forTenant(schema.users),
      eq(schema.users.role, "admin"),
      eq(schema.users.isActive, true),
    ));
  if (excludeId == null) return rows.length;
  return rows.filter((r) => r.id !== excludeId).length;
}

function pickAdminPatch(body: Record<string, unknown>) {
  const updates: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) updates.name = body.name.trim();
  if (typeof body.email === "string" && body.email.trim()) updates.email = body.email.trim().toLowerCase();
  if (body.role === "admin" || body.role === "operator" || body.role === "master") updates.role = body.role;
  if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
  if (body.phoneExtension === null || typeof body.phoneExtension === "string") {
    updates.phoneExtension = body.phoneExtension || null;
  }
  if (body.payrollRoleId === null || body.payrollRoleId === "") {
    updates.payrollRoleId = null;
  } else if (body.payrollRoleId != null) {
    const rid = Number(body.payrollRoleId);
    if (Number.isInteger(rid) && rid > 0) updates.payrollRoleId = rid;
  }
  return updates;
}

export const users = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const all = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      email: schema.users.email,
      role: schema.users.role,
      isActive: schema.users.isActive,
      phoneExtension: schema.users.phoneExtension,
      payrollRoleId: schema.users.payrollRoleId,
      onboardingCompleted: schema.users.onboardingCompleted,
      isChampion: schema.users.isChampion,
      createdAt: schema.users.createdAt,
    }).from(schema.users).where(forTenant(schema.users));
    return c.json({ users: all }, 200);
  })
  .post("/", requireAdmin, async (c) => {
    const body = await c.req.json();
    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();
    const password = body.password || "";
    const role = body.role === "admin" ? "admin" : body.role === "master" ? "master" : "operator";

    if (!name || !email) return c.json({ error: "Укажите имя и email" }, 400);
    const pwErr = validatePasswordStrength(password, email);
    if (pwErr) return c.json({ error: pwErr }, 400);

    const existing = await db.select().from(schema.users).where(eq(schema.users.email, email));
    if (existing.length) return c.json({ error: "Email уже занят" }, 409);

    const tenant = await getTenantById(tenantId());
    const quotaCheck = await canCreateUser(tenantId());
    if (!quotaCheck.allowed) {
      return c.json({ error: quotaCheck.reason || "Лимит пользователей по тарифу превышен" }, 403);
    }
    const activeUsers = await db.select({ id: schema.users.id })
      .from(schema.users)
      .where(and(forTenant(schema.users), eq(schema.users.isActive, true), eq(schema.users.role, "operator")));
    if (!canCreateMoreUsers(activeUsers.length + 1, tenant?.maxUsers)) {
      return c.json({ error: "Лимит пользователей по тарифу превышен" }, 403);
    }

    const passwordHash = await hashPassword(password);
    const [user] = await db.insert(schema.users).values({
      name, email, passwordHash, role, tenantId: tenantId(),
    }).returning();
    return c.json({ user: safeUser(user) }, 201);
  })
  .patch("/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);

    const target = await getUserInTenant(id);
    if (!target) return c.json({ error: "Пользователь не найден" }, 404);

    const body = await c.req.json();
    const currentUserId = c.get("userId") as number;
    const updates = pickAdminPatch(body);

    if (body.password) {
      const pwErr = validatePasswordStrength(String(body.password), target.email);
      if (pwErr) return c.json({ error: pwErr }, 400);
      updates.passwordHash = await hashPassword(String(body.password));
    }

    if (updates.role === "operator" && target.role === "admin") {
      const adminsLeft = await countActiveAdmins(id);
      if (adminsLeft < 1) {
        return c.json({ error: "Нельзя снять роль у последнего администратора" }, 400);
      }
    }

    if (updates.isActive === false && target.id === currentUserId) {
      return c.json({ error: "Нельзя деактивировать себя" }, 400);
    }

    if (updates.isActive === false && target.role === "admin") {
      const adminsLeft = await countActiveAdmins(id);
      if (adminsLeft < 1) {
        return c.json({ error: "Нельзя деактивировать последнего администратора" }, 400);
      }
    }

    if (updates.email && updates.email !== target.email) {
      const dup = await db.select().from(schema.users).where(eq(schema.users.email, updates.email as string));
      if (dup.some((u) => u.id !== id)) return c.json({ error: "Email уже занят" }, 409);
    }

    if (!Object.keys(updates).length) return c.json({ error: "Нет данных для обновления" }, 400);

    const [user] = await db.update(schema.users).set(updates)
      .where(withTenant(schema.users, eq(schema.users.id, id)))
      .returning();

    if (body.password || updates.isActive === false) {
      await revokeUserSessions(id);
    }

    return c.json({ user: safeUser(user) }, 200);
  })
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    if (Number.isNaN(id)) return c.json({ error: "Неверный id" }, 400);

    const currentUserId = c.get("userId") as number;
    if (id === currentUserId) return c.json({ error: "Нельзя удалить себя" }, 400);

    const target = await getUserInTenant(id);
    if (!target) return c.json({ error: "Пользователь не найден" }, 404);

    if (target.role === "admin") {
      const adminsLeft = await countActiveAdmins(id);
      if (adminsLeft < 1) {
        return c.json({ error: "Нельзя удалить последнего администратора" }, 400);
      }
    }

    await revokeUserSessions(id);
    await db.update(schema.users)
      .set({ isActive: false })
      .where(withTenant(schema.users, eq(schema.users.id, id)));

    return c.json({ ok: true }, 200);
  });
