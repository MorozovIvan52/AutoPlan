import { createMiddleware } from "hono/factory";
import { isAllowedOrigin, isAllowedReferer } from "../lib/cors-origins";
import { isProduction } from "../lib/env";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths that authenticate via signature/secret, not session cookie — skip CSRF. */
function csrfExemptPath(path: string): boolean {
  if (path.startsWith("/api/webhooks")) return true;
  if (path.startsWith("/api/public")) return true;
  if (path === "/api/client-errors") return true;
  if (path === "/api/seed") return true;
  if (path.startsWith("/api/auth/login") || path === "/api/auth/setup" || path === "/api/auth/demo-login") {
    return true;
  }
  return false;
}

/**
 * CSRF defense for cookie-authenticated mutations.
 * Validates Origin (preferred) or Referer against the same allowlist as CORS.
 */
export const csrfProtection = createMiddleware(async (c, next) => {
  if (!MUTATION_METHODS.has(c.req.method)) {
    await next();
    return;
  }
  if (csrfExemptPath(c.req.path)) {
    await next();
    return;
  }

  const origin = c.req.header("origin");
  const referer = c.req.header("referer");

  if (origin) {
    if (!isAllowedOrigin(origin)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
    return;
  }

  if (referer) {
    if (!isAllowedReferer(referer)) {
      return c.json({ error: "Forbidden" }, 403);
    }
    await next();
    return;
  }

  // Strict in production; allow CLI/tools without Origin in dev/test.
  if (isProduction()) {
    return c.json({ error: "Forbidden" }, 403);
  }

  await next();
});
