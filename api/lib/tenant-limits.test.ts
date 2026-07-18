import test from "node:test";
import assert from "node:assert/strict";
import { getPlanLimits, canCreateMoreUsers } from "./tenant.ts";

test("start plan has a small user limit", () => {
  const limits = getPlanLimits("start");
  assert.equal(limits.maxUsers, 3);
});

test("business plan allows more users", () => {
  const limits = getPlanLimits("business");
  assert.equal(limits.maxUsers, 25);
});

test("quota check blocks when the limit is reached", () => {
  assert.equal(canCreateMoreUsers(25, 25), false);
  assert.equal(canCreateMoreUsers(24, 25), true);
});
