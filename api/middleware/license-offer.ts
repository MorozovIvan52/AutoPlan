import { createMiddleware } from "hono/factory";
import { getAuthUser } from "../lib/session";
import { offerRequiredForUser, tenantOfferAccepted } from "../lib/license-offer";

const EXEMPT_PREFIXES = [
  "/auth",
  "/license-offer",
  "/health",
  "/metrics",
  "/public",
  "/webhooks",
  "/client-errors",
  "/tenants/register",
];

function normalizeApiPath(path: string): string {
  const raw = (path || "").split("?")[0] || "";
  return raw.startsWith("/api/") ? raw.slice(4) : raw === "/api" ? "/" : raw;
}

function isExempt(path: string): boolean {
  const p = normalizeApiPath(path);
  return EXEMPT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Блокирует API CRM, пока тенант не принял лицензионную оферту (SMS). */
export const enforceLicenseOffer = createMiddleware(async (c, next) => {
  const path = c.req.path;
  if (isExempt(path)) return next();
  const p = normalizeApiPath(path);
  if (["GET", "HEAD", "OPTIONS"].includes(c.req.method) && p.startsWith("/uploads/")) {
    return next();
  }

  const user = await getAuthUser(c);
  if (!user) return next();
  if (!offerRequiredForUser(user)) return next();

  const tenantId = user.tenantId ?? (c.get("tenantId") as number | undefined);
  if (tenantId == null || !Number.isFinite(tenantId) || tenantId <= 0) {
    return c.json({ error: "Пользователь не привязан к организации" }, 403);
  }
  if (await tenantOfferAccepted(tenantId)) return next();

  return c.json({
    error: "Требуется акцепт лицензионной оферты",
    code: "LICENSE_OFFER_REQUIRED",
  }, 403);
});
