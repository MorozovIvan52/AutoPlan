import type { safeUser } from "../lib/session";
import type { TenantRow } from "../lib/tenant";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
    userId: number;
    user: ReturnType<typeof safeUser>;
    tenantId: number;
    tenant: TenantRow;
  }
}
