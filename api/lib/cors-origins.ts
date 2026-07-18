/** Shared CORS / CSRF origin allowlist (api/index.ts + middleware/csrf.ts). */

export function allowedOriginsList(): string[] {
  return [
    process.env.PUBLIC_URL,
    "http://localhost:4200",
    "http://localhost:5173",
    "http://127.0.0.1:4200",
  ].filter(Boolean) as string[];
}

export function isAllowedOrigin(origin: string): boolean {
  const allowed = allowedOriginsList();
  if (allowed.includes(origin)) return true;
  const base = (process.env.TENANT_BASE_DOMAIN || "").trim().toLowerCase();
  if (!base) return false;
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === base || host.endsWith(`.${base}`);
  } catch {
    return false;
  }
}

/** Value for Access-Control-Allow-Origin (never wildcard with credentials). */
export function corsOriginHeader(origin: string | undefined): string {
  const allowed = allowedOriginsList();
  const fallback = allowed[0] || "http://localhost:4200";
  if (!origin) return fallback;
  if (isAllowedOrigin(origin)) return origin;
  return fallback;
}

export function isAllowedReferer(referer: string): boolean {
  try {
    const url = new URL(referer);
    return isAllowedOrigin(`${url.protocol}//${url.host}`);
  } catch {
    return false;
  }
}
