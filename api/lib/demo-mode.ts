import type { Context } from "hono";
import { sqlAll } from "../database/raw-sql";

export const DEMO_USER_EMAIL = "demo@crmavito.online";
export const DEMO_USER_NAME = "Демо-пользователь";

let demoClientIdsCache: number[] | null = null;

export function isDemoUser(user: { role?: string } | null | undefined): boolean {
  return user?.role === "demo";
}

export function invalidateDemoClientCache() {
  demoClientIdsCache = null;
}

export async function getDemoClientIds(): Promise<number[]> {
  if (demoClientIdsCache) return demoClientIdsCache;
  try {
    const rows = await sqlAll<{ id: number }>("SELECT id FROM clients WHERE is_demo = 1");
    demoClientIdsCache = rows.map((r) => r.id);
  } catch {
    demoClientIdsCache = [];
  }
  return demoClientIdsCache;
}

export async function isDemoClientId(clientId: number | null | undefined): Promise<boolean> {
  if (clientId == null) return false;
  const ids = await getDemoClientIds();
  return ids.includes(clientId);
}

export function demoAllowsMutation(c: Context): boolean {
  const url = new URL(c.req.url);
  const path = url.pathname;
  if (path.endsWith("/auth/logout")) return true;
  return false;
}

export function demoMutationBlockedResponse(c: Context) {
  return c.json({
    error: "Демо-режим: изменения недоступны. Запросите полный доступ у менеджера.",
    demo: true,
  }, 403);
}

export async function filterByDemoClients<T extends { clientId?: number | null; id?: number }>(
  user: { role?: string } | undefined,
  items: T[],
  clientKey: keyof T = "clientId" as keyof T,
): Promise<T[]> {
  if (!isDemoUser(user)) return items;
  const ids = new Set(await getDemoClientIds());
  return items.filter((item) => {
    const cid = item[clientKey] as number | null | undefined;
    return cid != null && ids.has(cid);
  });
}

export function filterDemoClientsList<T extends { id: number; isDemo?: boolean | null }>(
  user: { role?: string } | undefined,
  items: T[],
): T[] {
  if (!isDemoUser(user)) return items;
  return items.filter((item) => item.isDemo === true || (item as { is_demo?: number }).is_demo === 1);
}

export function filterDemoParts<T extends { isDemo?: boolean | null }>(
  user: { role?: string } | undefined,
  items: T[],
): T[] {
  if (!isDemoUser(user)) return items;
  return items.filter((item) => item.isDemo === true || (item as { is_demo?: number }).is_demo === 1);
}

export async function assertDemoClientAccess(
  user: { role?: string } | undefined,
  clientId: number | null | undefined,
): Promise<boolean> {
  if (!isDemoUser(user)) return true;
  return await isDemoClientId(clientId);
}
