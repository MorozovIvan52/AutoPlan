/**
 * Request logging middleware — requestId + tenantId + userId (как hono-pino).
 */
import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";
import { log } from "../lib/logger";
import { getTenantIdOrNull } from "../lib/tenant-context";

export type RequestLogVariables = {
  requestId: string;
};

export const requestLog = createMiddleware(async (c, next) => {
  const incoming = c.req.header("x-request-id")?.trim();
  const requestId = incoming && incoming.length <= 64 ? incoming : randomUUID();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);

  const started = Date.now();
  let userId: number | undefined;

  try {
    await next();
  } finally {
    const tenantId = getTenantIdOrNull();
    const uid = c.get("userId") as number | undefined;
    if (typeof uid === "number") userId = uid;

    const status = c.res.status;
    const ms = Date.now() - started;
    const path = c.req.path;
    const skip =
      path === "/api/health" || path === "/api/metrics" || path.endsWith("/health");

    if (!skip) {
      const bindings = {
        requestId,
        tenantId,
        userId,
        method: c.req.method,
        path,
        status,
        ms,
      };
      if (status >= 500) log.error(bindings, "request");
      else if (status >= 400) log.warn(bindings, "request");
      else log.info(bindings, "request");
    }
  }
});
