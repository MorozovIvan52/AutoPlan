import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { getAuthUser, safeUser } from "../lib/session";
import { touchSessionActivity } from "../lib/activity-track";
import { demoAllowsMutation, demoMutationBlockedResponse, isDemoUser } from "../lib/demo-mode";
import { setTenantContext } from "../lib/tenant-context";

function touchActivity(c: Parameters<typeof getCookie>[0], userId: number) {
  void touchSessionActivity(getCookie(c, "session"), userId);
}

function userTenantId(user: { tenantId?: number | null }): number | null {
  const tid = user.tenantId;
  if (tid == null || !Number.isFinite(tid) || tid <= 0) return null;
  return tid;
}

function bindUserTenant(c: { set: (k: "tenantId", v: number) => void }, tid: number) {
  c.set("tenantId", tid);
  setTenantContext({ tenantId: tid });
}

export const requireAuth = createMiddleware(async (c, next) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);

  const tid = userTenantId(user);
  if (tid == null) {
    return c.json({ error: "Пользователь не привязан к организации" }, 403);
  }

  const requestTenantId = c.get("tenantId") as number | undefined;
  if (requestTenantId && requestTenantId !== tid) {
    return c.json({ error: "Доступ к этой организации запрещён" }, 403);
  }

  if (isDemoUser(user) && ["POST", "PATCH", "PUT", "DELETE"].includes(c.req.method)) {
    if (!demoAllowsMutation(c)) {
      return demoMutationBlockedResponse(c);
    }
  }

  c.set("user", safeUser(user));
  c.set("userId", user.id);
  bindUserTenant(c, tid);
  touchActivity(c, user.id);
  await next();
});

export const requireAdmin = createMiddleware(async (c, next) => {
  const user = await getAuthUser(c);
  if (!user) return c.json({ error: "Unauthorized" }, 401);
  if (user.role !== "admin") return c.json({ error: "Forbidden" }, 403);

  const tid = userTenantId(user);
  if (tid == null) {
    return c.json({ error: "Пользователь не привязан к организации" }, 403);
  }

  const requestTenantId = c.get("tenantId") as number | undefined;
  if (requestTenantId && requestTenantId !== tid) {
    return c.json({ error: "Доступ к этой организации запрещён" }, 403);
  }

  c.set("user", safeUser(user));
  c.set("userId", user.id);
  bindUserTenant(c, tid);
  touchActivity(c, user.id);
  await next();
});
