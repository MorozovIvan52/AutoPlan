import type { IncomingMessage } from "node:http";
import { getSessionUserId } from "./session";

function isAllowedWsOrigin(origin: string | undefined): boolean {
  if (!origin) return true;
  const allowed = [
    process.env.PUBLIC_URL,
    "http://localhost:4200",
    "http://localhost:5173",
    "http://127.0.0.1:4200",
  ].filter(Boolean) as string[];
  return allowed.some((a) => origin === a || origin.startsWith(a.replace(/\/$/, "")));
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
