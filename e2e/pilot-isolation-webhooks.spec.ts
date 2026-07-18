/**
 * E2E: tenant isolation + Stripe webhook reject.
 * Isolation: E2E_COOKIE_A / E2E_COOKIE_B + E2E_FOREIGN_CLIENT_ID (id from tenant A).
 * Without cookies — only webhook signature smoke via request.
 */
import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";

const cookieA = process.env.E2E_COOKIE_A || "";
const cookieB = process.env.E2E_COOKIE_B || "";
const foreignClientId = process.env.E2E_FOREIGN_CLIENT_ID || "";

test.describe("Pilot: Stripe webhook harden", () => {
  test("rejects unsigned webhook", async ({ request }) => {
    const res = await request.post("/api/webhooks/stripe", {
      data: { id: "evt_e2e", type: "invoice.paid", data: { object: {} } },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).not.toBe(200);
    expect([400, 500, 503]).toContain(res.status());
  });

  test("rejects forged signature", async ({ request }) => {
    const res = await request.post("/api/webhooks/stripe", {
      data: { id: "evt_e2e2", type: "invoice.paid", data: { object: {} } },
      headers: {
        "Content-Type": "application/json",
        "stripe-signature": "t=1,v1=deadbeef",
      },
    });
    expect(res.status()).not.toBe(200);
    expect([400, 500, 503]).toContain(res.status());
  });
});

test.describe("Pilot: tenant isolation", () => {
  test("own client visible after login", async ({ page }) => {
    await loginAsE2eUser(page);
    const res = await page.request.get("/api/clients");
    expect(res.status()).toBe(200);
    const body = await res.json() as { clients?: { id: number }[] };
    expect(Array.isArray(body.clients)).toBe(true);
  });

  test("cross-tenant client id returns 404 when cookies set", async ({ request }) => {
    test.skip(!cookieA || !cookieB || !foreignClientId, "Set E2E_COOKIE_A/B and E2E_FOREIGN_CLIENT_ID");

    const a = await request.get(`/api/clients/${foreignClientId}`, {
      headers: { Cookie: cookieA },
    });
    expect(a.status()).toBe(200);

    const b = await request.get(`/api/clients/${foreignClientId}`, {
      headers: { Cookie: cookieB },
    });
    expect(b.status()).toBe(404);
  });
});
