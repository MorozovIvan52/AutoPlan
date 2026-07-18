import test from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "../middleware/security.ts";

test("clientIp uses socket when TRUST_PROXY is off", () => {
  const ip = clientIp({
    req: {
      header: () => undefined,
      raw: { socket: { remoteAddress: "::ffff:192.168.1.50" } },
    },
  });
  assert.equal(ip, "192.168.1.50");
});

test("clientIp ignores spoofed XFF without trusted proxy peer", () => {
  process.env.TRUST_PROXY = "1";
  const ip = clientIp({
    req: {
      header: (name: string) => (name === "x-forwarded-for" ? "1.2.3.4, 10.0.0.1" : undefined),
      raw: { socket: { remoteAddress: "203.0.113.9" } },
    },
  });
  assert.equal(ip, "203.0.113.9");
  delete process.env.TRUST_PROXY;
});

test("clientIp parses XFF when peer is trusted proxy", () => {
  process.env.TRUST_PROXY = "1";
  process.env.TRUSTED_PROXY_IPS = "127.0.0.1";
  const ip = clientIp({
    req: {
      header: (name: string) => (name === "x-forwarded-for" ? "203.0.113.50, 127.0.0.1" : undefined),
      raw: { socket: { remoteAddress: "127.0.0.1" } },
    },
  });
  assert.equal(ip, "203.0.113.50");
  delete process.env.TRUST_PROXY;
  delete process.env.TRUSTED_PROXY_IPS;
});
