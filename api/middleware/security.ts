import { createMiddleware } from "hono/factory";
import { timingSafeEqual } from "node:crypto";
import { isProduction, isPublicDeployment } from "../lib/env";

const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const setupAttempts = new Map<string, { count: number; resetAt: number }>();
const webhookAttempts = new Map<string, { count: number; resetAt: number }>();

const LOGIN_MAX = 15;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const SETUP_MAX = 10;
const SETUP_WINDOW_MS = 15 * 60 * 1000;
const WEBHOOK_MAX = 120;
const WEBHOOK_WINDOW_MS = 60 * 1000;

const TRUSTED_PROXY_IPS = () =>
  (process.env.TRUSTED_PROXY_IPS || "127.0.0.1,::1")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const securityHeaders = createMiddleware(async (c, next) => {
  await next();
  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "SAMEORIGIN");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (isProduction() || isPublicDeployment()) {
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data: blob: https:; media-src 'self' blob: https:; connect-src 'self' wss: https:; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    );
  }
});

export function timingSafeEqualText(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  if (trimmed.startsWith("::ffff:")) return trimmed.slice(7);
  return trimmed;
}

function socketRemoteAddress(c: {
  req: { raw?: unknown };
}): string | null {
  const raw = c.req.raw as { socket?: { remoteAddress?: string } } | undefined;
  const addr = raw?.socket?.remoteAddress;
  return addr ? normalizeIp(addr) : null;
}

function isTrustedProxy(direct: string): boolean {
  return TRUSTED_PROXY_IPS().includes(direct);
}

function clientIpFromForwarded(forwarded: string, trustedHops: number): string | null {
  const hops = forwarded
    .split(",")
    .map((s) => normalizeIp(s))
    .filter(Boolean);
  if (!hops.length) return null;
  const idx = hops.length - trustedHops - 1;
  if (idx >= 0) return hops[idx]!;
  return hops[0]!;
}

type IpContext = {
  req: {
    header: (name: string) => string | undefined;
    raw?: unknown;
  };
};

/**
 * Resolve client IP for rate limiting and audit.
 * - Without TRUST_PROXY: uses socket remoteAddress (never a shared "unknown" bucket).
 * - With TRUST_PROXY=1: trusts X-Forwarded-For / X-Real-IP only when the direct peer is a known proxy.
 */
export function clientIp(c: IpContext): string {
  const direct = socketRemoteAddress(c);

  if (process.env.TRUST_PROXY === "1" && direct && isTrustedProxy(direct)) {
    const trustedHops = Math.max(1, parseInt(process.env.TRUSTED_PROXY_HOPS || "1", 10) || 1);
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const fromXff = clientIpFromForwarded(xff, trustedHops);
      if (fromXff) return fromXff;
    }
    const real = c.req.header("x-real-ip")?.trim();
    if (real) return normalizeIp(real);
  }

  if (direct) return direct;
  return "127.0.0.1";
}

function pruneRateMap(map: Map<string, { count: number; resetAt: number }>, now: number) {
  if (map.size < 5000) return;
  for (const [key, entry] of map) {
    if (now > entry.resetAt) map.delete(key);
  }
}

function checkRate(
  map: Map<string, { count: number; resetAt: number }>,
  key: string,
  max: number,
  windowMs: number,
): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  pruneRateMap(map, now);
  const entry = map.get(key);
  if (!entry || now > entry.resetAt) {
    map.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true };
  }
  if (entry.count >= max) {
    return { ok: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  entry.count++;
  return { ok: true };
}

function checkRateAll(
  map: Map<string, { count: number; resetAt: number }>,
  keys: string[],
  max: number,
  windowMs: number,
): { ok: boolean; retryAfterSec?: number } {
  for (const key of keys) {
    const r = checkRate(map, key, max, windowMs);
    if (!r.ok) return r;
  }
  return { ok: true };
}

export function checkLoginRateLimit(ip: string, email?: string) {
  const keys = [`ip:${ip}`];
  if (email) keys.push(`email:${email.trim().toLowerCase()}`);
  return checkRateAll(loginAttempts, keys, LOGIN_MAX, LOGIN_WINDOW_MS);
}

export function checkSetupRateLimit(ip: string) {
  return checkRate(setupAttempts, `ip:${ip}`, SETUP_MAX, SETUP_WINDOW_MS);
}

export function checkWebhookRateLimit(ip: string) {
  return checkRate(webhookAttempts, `ip:${ip}`, WEBHOOK_MAX, WEBHOOK_WINDOW_MS);
}

export function resetLoginRateLimit(ip: string, email?: string) {
  loginAttempts.delete(`ip:${ip}`);
  if (email) loginAttempts.delete(`email:${email.trim().toLowerCase()}`);
}
