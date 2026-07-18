import type { APIRequestContext } from "@playwright/test";

export type QuotasResponse = Record<string, {
  used: number;
  limit: number;
  isExceeded: boolean;
}>;

export async function apiGet<T>(request: APIRequestContext, path: string): Promise<{ status: number; body: T }> {
  const res = await request.get(path);
  const body = await res.json().catch(() => ({})) as T;
  return { status: res.status(), body };
}

export async function apiPost<T>(request: APIRequestContext, path: string, data?: unknown): Promise<{ status: number; body: T }> {
  const res = await request.post(path, {
    data,
    headers: { "Content-Type": "application/json" },
  });
  const body = await res.json().catch(() => ({})) as T;
  return { status: res.status(), body };
}
