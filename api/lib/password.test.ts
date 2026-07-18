import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "./password.ts";

test("scrypt hash verifies and does not need rehash", async () => {
  const hash = await hashPassword("TestPass123");
  assert.match(hash, /^scrypt:/);
  const r = await verifyPassword("TestPass123", hash);
  assert.equal(r.ok, true);
  assert.equal(r.needsRehash, false);
  const bad = await verifyPassword("wrong", hash);
  assert.equal(bad.ok, false);
});

test("legacy SHA-256 fails closed without AUTH_SALT", async () => {
  const prev = process.env.AUTH_SALT;
  delete process.env.AUTH_SALT;
  try {
    const legacyHash = "abc123deadbeef";
    const r = await verifyPassword("any", legacyHash);
    assert.equal(r.ok, false);
    assert.equal(r.needsRehash, false);
  } finally {
    if (prev) process.env.AUTH_SALT = prev;
  }
});

test("legacy SHA-256 verifies with AUTH_SALT and needs rehash", async () => {
  const prev = process.env.AUTH_SALT;
  process.env.AUTH_SALT = "test-pepper-ci-only";
  try {
    const data = new TextEncoder().encode("LegacyPass1" + process.env.AUTH_SALT);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const legacyHash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const r = await verifyPassword("LegacyPass1", legacyHash);
    assert.equal(r.ok, true);
    assert.equal(r.needsRehash, true);
  } finally {
    if (prev) process.env.AUTH_SALT = prev;
    else delete process.env.AUTH_SALT;
  }
});
