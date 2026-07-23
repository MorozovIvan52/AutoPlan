import test from "node:test";
import assert from "node:assert/strict";
import {
  getTenantId,
  getTenantIdOrNull,
  runWithTenant,
  TenantContextError,
} from "./tenant-context.ts";

test("getTenantId throws without context (no silent fallback to 1)", () => {
  assert.equal(getTenantIdOrNull(), null);
  assert.throws(() => getTenantId(), (e: unknown) => e instanceof TenantContextError);
});

test("getTenantId returns ALS value inside runWithTenant", () => {
  const id = runWithTenant({ tenantId: 42, tenantSlug: "sto2" }, () => getTenantId());
  assert.equal(id, 42);
  assert.equal(getTenantIdOrNull(), null);
});
