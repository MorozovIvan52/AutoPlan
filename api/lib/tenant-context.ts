import { AsyncLocalStorage } from "node:async_hooks";

export type TenantContext = {
  tenantId: number;
  tenantSlug?: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

export class TenantContextError extends Error {
  constructor(message = "Контекст организации не задан") {
    super(message);
    this.name = "TenantContextError";
  }
}

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function setTenantContext(ctx: TenantContext) {
  if (!Number.isFinite(ctx.tenantId) || ctx.tenantId <= 0) {
    throw new TenantContextError("Некорректный tenantId");
  }
  const current = storage.getStore();
  if (current) {
    current.tenantId = ctx.tenantId;
    current.tenantSlug = ctx.tenantSlug;
    return;
  }
  storage.enterWith(ctx);
}

/** Текущий tenantId. Без контекста — ошибка (не падаем тихо в id=1). */
export function getTenantId(): number {
  const id = storage.getStore()?.tenantId;
  if (id == null || !Number.isFinite(id) || id <= 0) {
    throw new TenantContextError();
  }
  return id;
}

/** Для логов / health: null если ALS пуст. */
export function getTenantIdOrNull(): number | null {
  const id = storage.getStore()?.tenantId;
  if (id == null || !Number.isFinite(id) || id <= 0) return null;
  return id;
}

export function getTenantSlug(): string | undefined {
  return storage.getStore()?.tenantSlug;
}
