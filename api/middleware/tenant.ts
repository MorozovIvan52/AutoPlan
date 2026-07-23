import { createMiddleware } from "hono/factory";
import {
  resolveTenantFromRequest,
  subscriptionAllowsAccess,
  subscriptionAllowsMutations,
  type TenantRow,
} from "../lib/tenant";
import { setTenantContext, runWithTenant } from "../lib/tenant-context";
import { getAuthUser } from "../lib/session";

declare module "hono" {
  interface ContextVariableMap {
    tenant: TenantRow;
    tenantId: number;
  }
}

export const resolveTenant = createMiddleware(async (c, next) => {
  const tenant = await resolveTenantFromRequest({
    host: c.req.header("host"),
    headerTenantId: c.req.header("x-tenant-id"),
    headerTenantSlug: c.req.header("x-tenant-slug"),
  });

  if (!tenant) {
    return c.json({ error: "Организация не найдена" }, 404);
  }

  c.set("tenant", tenant);
  c.set("tenantId", tenant.id);
  setTenantContext({ tenantId: tenant.id, tenantSlug: tenant.slug });

  await runWithTenant({ tenantId: tenant.id, tenantSlug: tenant.slug }, async () => {
    await next();
  });
});

/** После resolveTenant + requireAuth: пользователь должен принадлежать организации */
export const enforceTenantUser = createMiddleware(async (c, next) => {
  const tenant = c.get("tenant") as TenantRow | undefined;
  const user = await getAuthUser(c);
  if (user && tenant && user.tenantId !== tenant.id) {
    return c.json({ error: "Доступ к этой организации запрещён" }, 403);
  }
  if (user && !tenant) {
    const tid = user.tenantId;
    if (tid == null || !Number.isFinite(tid) || tid <= 0) {
      return c.json({ error: "Пользователь не привязан к организации" }, 403);
    }
    setTenantContext({ tenantId: tid });
    c.set("tenantId", tid);
  }
  await next();
});

export const requireActiveSubscription = createMiddleware(async (c, next) => {
  const tenant = c.get("tenant") as TenantRow | undefined;
  if (!tenant) return c.json({ error: "Организация не определена" }, 400);

  if (!subscriptionAllowsAccess(tenant)) {
    return c.json({
      error: "Подписка истекла",
      code: "subscription_expired",
      subscriptionStatus: tenant.subscriptionStatus,
    }, 402);
  }

  if (["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method) && !subscriptionAllowsMutations(tenant)) {
    return c.json({
      error: "Изменения недоступны — продлите подписку",
      code: "subscription_readonly",
    }, 402);
  }

  await next();
});

const SUBSCRIPTION_EXEMPT_PREFIXES = [
  "/auth",
  "/public",
  "/webhooks",
  "/tenants/register",
  "/seed",
  "/health",
  "/metrics",
];

/** Проверка подписки на всех мутирующих запросах (кроме auth, webhooks, seed) */
export const enforceSubscriptionOnMutations = createMiddleware(async (c, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    await next();
    return;
  }

  const path = c.req.path;
  if (SUBSCRIPTION_EXEMPT_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    await next();
    return;
  }

  const tenant = c.get("tenant") as TenantRow | undefined;
  if (!tenant) {
    await next();
    return;
  }

  if (!subscriptionAllowsAccess(tenant)) {
    return c.json({
      error: "Подписка истекла",
      code: "subscription_expired",
      subscriptionStatus: tenant.subscriptionStatus,
    }, 402);
  }

  if (!subscriptionAllowsMutations(tenant)) {
    return c.json({
      error: "Изменения недоступны — продлите подписку",
      code: "subscription_readonly",
    }, 402);
  }

  await next();
});
