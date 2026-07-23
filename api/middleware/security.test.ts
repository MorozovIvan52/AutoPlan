import test from "node:test";
import assert from "node:assert/strict";
import { clientIp } from "../middleware/security.ts";

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    prev[key] = process.env[key];
    const v = vars[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
  try {
    fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
  }
}

test("clientIp uses socket when TRUST_PROXY is off", () => {
  withEnv({ TRUST_PROXY: undefined, TRUSTED_PROXY_IPS: undefined }, () => {
    const ip = clientIp({
      req: {
        header: () => undefined,
        raw: { socket: { remoteAddress: "::ffff:192.168.1.50" } },
      },
    });
    assert.equal(ip, "192.168.1.50");
  });
});

test("clientIp ignores spoofed XFF without trusted proxy peer", () => {
  withEnv({ TRUST_PROXY: "1", TRUSTED_PROXY_IPS: "127.0.0.1,::1" }, () => {
    const ip = clientIp({
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? "1.2.3.4, 10.0.0.1" : undefined),
        raw: { socket: { remoteAddress: "203.0.113.9" } },
      },
    });
    assert.equal(ip, "203.0.113.9");
  });
});

test("clientIp parses XFF when peer is trusted proxy", () => {
  withEnv({ TRUST_PROXY: "1", TRUSTED_PROXY_IPS: "127.0.0.1" }, () => {
    const ip = clientIp({
      req: {
        header: (name: string) => (name === "x-forwarded-for" ? "203.0.113.50, 127.0.0.1" : undefined),
        raw: { socket: { remoteAddress: "127.0.0.1" } },
      },
    });
    assert.equal(ip, "203.0.113.50");
  });
});
