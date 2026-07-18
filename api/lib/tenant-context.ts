import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_TENANT_ID } from "./tenant-bootstrap";

export type TenantContext = {
  tenantId: number;
  tenantSlug?: string;
};

const storage = new AsyncLocalStorage<TenantContext>();

export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function setTenantContext(ctx: TenantContext) {
  const current = storage.getStore();
  if (current) {
    current.tenantId = ctx.tenantId;
    current.tenantSlug = ctx.tenantSlug;
    return;
  }
  storage.enterWith(ctx);
}

export function getTenantId(): number {
  return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}

export function getTenantSlug(): string | undefined {
  return storage.getStore()?.tenantSlug;
}
