import type { APIRequestContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type PilotManifest = {
  password: string;
  tenants: Array<{
    slug: string;
    id: number;
    users: Array<{ role: string; email: string; id: number }>;
    clientId: number;
    conversationId: number;
    deals: { closedId: number; draftId: number };
    racePartArticle: string;
    receiptDocId: number | null;
  }>;
};

export const PILOT_PASSWORD = process.env.PILOT_PASSWORD || "PilotDemo2026!";

export function loadPilotManifest(): PilotManifest | null {
  const path = join(process.cwd(), "scripts", "pilot-demo-manifest.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PilotManifest;
}

export function pilotAuditEnabled(): boolean {
  return process.env.PILOT_AUDIT === "1" || !!process.env.PILOT_TENANT_SLUG;
}

export function tenantHeaders(slug = process.env.PILOT_TENANT_SLUG || "sto-1"): Record<string, string> {
  return { "x-tenant-slug": slug };
}

export async function loginAsPilotUser(
  page: Page,
  opts: {
    tenantSlug?: string;
    email?: string;
    password?: string;
  } = {},
) {
  const tenantSlug = opts.tenantSlug || process.env.PILOT_TENANT_SLUG || "sto-1";
  const email = opts.email || process.env.PILOT_LOGIN || "admin@sto1.demo";
  const password = opts.password || PILOT_PASSWORD;

  const res = await page.request.post("/api/auth/login", {
    headers: { "Content-Type": "application/json", ...tenantHeaders(tenantSlug) },
    data: { email, password },
  });
  expect(res.ok(), `login failed: ${await res.text()}`).toBeTruthy();

  await page.goto("/");
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}

export async function apiGetOk(
  request: APIRequestContext,
  path: string,
  tenantSlug = process.env.PILOT_TENANT_SLUG || "sto-1",
): Promise<{ ok: boolean; status: number; path: string }> {
  const res = await request.get(path, { headers: tenantHeaders(tenantSlug) });
  return { ok: res.ok(), status: res.status(), path };
}

/** Все основные GET API CRM — smoke для аудита */
export const API_GET_SMOKE: string[] = [
  "/api/clients",
  "/api/deals?orderType=service",
  "/api/deals?orderType=parts",
  "/api/parts",
  "/api/conversations",
  "/api/tasks",
  "/api/notifications",
  "/api/channels",
  "/api/users",
  "/api/analytics/overview",
  "/api/analytics/today",
  "/api/crm/settings",
  "/api/templates",
  "/api/sales",
  "/api/calls",
  "/api/service/appointments",
  "/api/sto/owner-dashboard",
  `/api/sto/day-board?date=${new Date().toISOString().slice(0, 10)}`,
  "/api/team-chat/groups",
  "/api/integrations/types",
  "/api/export/clients.csv",
  "/api/export/work-orders.csv",
  "/api/export/stock.csv",
  "/api/cdek/shipments",
  "/api/cdek/status",
  "/api/buyouts",
  "/api/zzap/status",
  "/api/zzap/lists",
  "/api/payroll/roles",
  "/api/payroll/my",
  "/api/ai/status",
];

/** Все страницы UI из app.tsx / nav */
export const UI_ROUTES: { path: string; name: string }[] = [
  { path: "/", name: "Входящие" },
  { path: "/dashboard", name: "Дашборд" },
  { path: "/assistant", name: "AI-боты" },
  { path: "/clients", name: "Клиенты" },
  { path: "/deals", name: "Заказы" },
  { path: "/zn", name: "ЗН" },
  { path: "/sales", name: "Реализация" },
  { path: "/delivery", name: "Доставка" },
  { path: "/money", name: "Деньги" },
  { path: "/warehouse", name: "Склад" },
  { path: "/buyouts", name: "Выкуп" },
  { path: "/zzap", name: "ZZap" },
  { path: "/payroll", name: "Расчёт ЗП" },
  { path: "/my-salary", name: "Моя зарплата" },
  { path: "/tasks", name: "Задачи" },
  { path: "/calendar", name: "Календарь" },
  { path: "/calls", name: "Звонки" },
  { path: "/repairs", name: "Запись на ремонт" },
  { path: "/team", name: "Командный чат" },
  { path: "/marketing", name: "Маркетинг" },
  { path: "/analytics", name: "Аналитика" },
  { path: "/settings", name: "Настройки" },
];
