import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { resolveTenant, requireActiveSubscription } from "../middleware/tenant";
import {
  provisionTenant,
  computeAdoptionRate,
  getTenantById,
  getPlanLimits,
} from "../lib/tenant";
import { getTenantQuotas, updateUsage } from "../lib/quota-enforcement";
import { ensureTenantSubscription } from "../lib/saas-bootstrap";
import { validatePasswordStrength } from "../lib/password";
import { log } from "../lib/logger";
import { checkSetupRateLimit, clientIp, timingSafeEqualText } from "../middleware/security";
import { isProduction, isSecureCookies } from "../lib/env";
import { createSession, safeUser } from "../lib/session";
import { setCookie } from "hono/cookie";

function sessionCookieOptions() {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "Lax" as const,
    maxAge: 60 * 60 * 24 * 7,
    secure: isSecureCookies(),
  };
}

export const tenants = new Hono()
  .use("*", resolveTenant)

  /** Self-service регистрация новой организации (SaaS provisioning) */
  .post("/register", async (c) => {
    const ip = clientIp(c);
    const limit = checkSetupRateLimit(ip);
    if (!limit.ok) {
      return c.json({ error: `Слишком много попыток. Повторите через ${limit.retryAfterSec} сек.` }, 429);
    }

    const regKey = process.env.TENANT_REGISTER_SECRET?.trim();
    if (isProduction() && !regKey) {
      return c.json({ error: "Регистрация отключена. Обратитесь в поддержку АвтоПлан." }, 403);
    }

    const body = await c.req.json<{
      companyName?: string;
      subdomain?: string;
      adminName?: string;
      adminEmail?: string;
      adminPassword?: string;
      registerKey?: string;
    }>();

    if (regKey) {
      const provided = c.req.header("x-register-key") || body.registerKey || "";
      if (!provided || !timingSafeEqualText(provided, regKey)) {
        return c.json({ error: "Неверный ключ регистрации" }, 403);
      }
    }

    const email = (body.adminEmail || "").trim().toLowerCase();
    const password = body.adminPassword || "";
    const companyName = (body.companyName || "").trim();
    if (!companyName) return c.json({ error: "Укажите название компании" }, 400);
    if (!email || !email.includes("@")) return c.json({ error: "Укажите корректный email" }, 400);
    const pwErr = validatePasswordStrength(password, email);
    if (pwErr) return c.json({ error: pwErr }, 400);

    try {
      const { tenant, admin } = await provisionTenant({
        companyName,
        subdomain: body.subdomain?.trim(),
        adminName: body.adminName || "Администратор",
        adminEmail: email,
        adminPassword: password,
      });

      await ensureTenantSubscription(tenant.id, tenant.subscriptionPlan || "start");

      const sessionId = await createSession(admin!.id);
      setCookie(c, "session", sessionId, sessionCookieOptions());

      return c.json({
        ok: true,
        tenant: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          subdomain: tenant.subdomain,
          subscriptionStatus: tenant.subscriptionStatus,
          trialEndsAt: tenant.trialEndsAt,
        },
        user: safeUser(admin!),
        loginUrl: tenant.subdomain
          ? `https://${tenant.subdomain}.${process.env.TENANT_BASE_DOMAIN || "crmavito.online"}`
          : undefined,
      }, 201);
    } catch (e: unknown) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, "tenant_register");
      return c.json({ error: "Ошибка регистрации" }, 400);
    }
  })

  .get("/current", requireAuth, requireActiveSubscription, async (c) => {
    const tenantId = c.get("tenantId") as number;
    const tenant = await getTenantById(tenantId);
    if (!tenant) return c.json({ error: "Организация не найдена" }, 404);
    const limits = getPlanLimits(tenant.subscriptionPlan);
    return c.json({ tenant, limits }, 200);
  })

  .get("/quotas", requireAuth, async (c) => {
    const tenantId = c.get("tenantId") as number;
    await ensureTenantSubscription(tenantId);
    await updateUsage(tenantId);
    const quotas = await getTenantQuotas(tenantId);
    return c.json(quotas, 200);
  })

  .get("/adoption", requireAuth, requireAdmin, requireActiveSubscription, async (c) => {
    const tenantId = c.get("tenantId") as number;
    const days = Number(c.req.query("days") || 7);
    const stats = await computeAdoptionRate(tenantId, Number.isFinite(days) ? days : 7);
    return c.json({ ...stats, periodDays: days }, 200);
  })

  .patch("/onboarding", requireAuth, async (c) => {
    const userId = c.get("userId") as number;
    const body = await c.req.json<{ completed?: boolean }>();
    await db.update(schema.users)
      .set({ onboardingCompleted: body.completed !== false })
      .where(eq(schema.users.id, userId));
    return c.json({ ok: true }, 200);
  });
