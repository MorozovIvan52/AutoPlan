import { and, eq, type SQL, type AnyColumn } from "drizzle-orm";
import { getTenantId } from "./tenant-context";

type TenantTable = { tenantId: AnyColumn };

export function tenantId(): number {
  return getTenantId();
}

export function forTenant<T extends TenantTable>(table: T): SQL {
  return eq(table.tenantId, getTenantId());
}

export function withTenant<T extends TenantTable>(
  table: T,
  ...conditions: (SQL | undefined)[]
): SQL {
  const parts = [forTenant(table), ...conditions.filter(Boolean)] as SQL[];
  return parts.length === 1 ? parts[0]! : and(...parts)!;
}
