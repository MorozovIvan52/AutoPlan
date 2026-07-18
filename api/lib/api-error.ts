import type { Context } from "hono";
import { log } from "./logger";

export type SafeErrorResult = { error: string; code?: string; status: number };

/** Business errors with explicit 4xx status — safe to return message to client. */
export function isClientSafeError(
  e: unknown,
): e is { message: string; status: number; code?: string } {
  if (typeof e !== "object" || e === null || !("message" in e) || !("status" in e)) return false;
  const status = (e as { status: unknown }).status;
  return typeof status === "number" && status >= 400 && status < 500;
}

/**
 * Map unknown errors to a fixed client message; log raw detail server-side only.
 * Pass through isClientSafeError (4xx) and CloseDealError-like objects.
 */
export function safeApiError(
  e: unknown,
  fallback: string,
  defaultStatus = 500,
  logLabel?: string,
): SafeErrorResult {
  if (isClientSafeError(e)) {
    return { error: e.message, code: e.code, status: e.status };
  }
  const raw = e instanceof Error ? e.message : String(e);
  if (logLabel) log.error({ err: raw }, logLabel);
  else if (defaultStatus >= 500) log.error({ err: raw }, fallback);
  return { error: fallback, status: defaultStatus };
}

export function jsonApiError(
  c: Context,
  e: unknown,
  fallback: string,
  defaultStatus = 500,
  logLabel?: string,
) {
  const { error, code, status } = safeApiError(e, fallback, defaultStatus, logLabel);
  const body = code ? { error, code } : { error };
  return c.json(body, status as 400 | 401 | 403 | 404 | 409 | 429 | 500 | 502 | 503);
}
