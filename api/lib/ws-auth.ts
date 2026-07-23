import type { IncomingMessage } from "node:http";
import { getSessionUserId } from "./session";

function normalizeOrigin(raw: string): string {
  return raw.trim().replace(/\/$/, "").toLowerCase();
}

/** Разрешённые Origin: PUBLIC_URL, localhost, *.CRM_ROOT_DOMAIN, www. */
function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const o = normalizeOrigin(origin);

  const allowedExact = [
    process.env.PUBLIC_URL,
    process.env.APP_URL,
    "http://localhost:4200",
    "http://localhost:5173",
    "http://127.0.0.1:4200",
    "https://localhost:4200",
  ]
    .filter(Boolean)
    .map((a) => normalizeOrigin(String(a)));

  if (allowedExact.some((a) => o === a)) return true;

  const root = (process.env.CRM_ROOT_DOMAIN || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "");
  if (root) {
    try {
      const u = new URL(o);
      const host = u.hostname.toLowerCase();
      if (host === root || host === `www.${root}` || host.endsWith(`.${root}`)) {
        return u.protocol === "https:" || u.protocol === "http:";
      }
    } catch {
      return false;
    }
  }

  // Fallback: тот же host, что в запросе (за прокси)
  return false;
}

export function sessionIdFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [name, ...rest] = part.trim().split("=");
    if (name === "session" && rest.length) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

/** Проверка сессии при WebSocket upgrade. Возвращает userId или null. */
export async function authenticateWsUpgrade(req: IncomingMessage): Promise<number | null> {
  const origin = req.headers.origin;
  if (origin && !isAllowedWsOrigin(origin)) return null;
  const sid = sessionIdFromCookieHeader(req.headers.cookie);
  const userId = await getSessionUserId(sid);
  return userId ?? null;
}
