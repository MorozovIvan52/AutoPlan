import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";
import { apiGet, type QuotasResponse } from "./helpers/billing";

test.describe("SaaS Billing", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2eUser(page);
  });

  test("quotas API returns tenant limits", async ({ page }) => {
    const { status, body } = await apiGet<QuotasResponse>(page.request, "/api/tenants/quotas");
    expect(status).toBe(200);
    expect(body.users).toBeDefined();
    expect(body.channels).toBeDefined();
    expect(typeof body.users.used).toBe("number");
    expect(typeof body.users.limit).toBe("number");
    expect(body.users.limit).toBeGreaterThan(0);
  });

  test("admin billing subscription API", async ({ page }) => {
    const { status, body } = await apiGet<{
      subscription?: { displayName: string; status: string };
      limits?: { users: { limit: number } };
    }>(page.request, "/api/admin/billing/subscription");

    expect(status).toBe(200);
    expect(body.subscription?.displayName).toBeTruthy();
    expect(body.subscription?.status).toMatch(/active|trial|past_due|canceled|expired/);
    expect(body.limits?.users?.limit).toBeGreaterThan(0);
  });

  test("billing page renders for admin", async ({ page }) => {
    await page.goto("/admin/billing");
    await expect(page.getByText("Подписка и лимиты")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Текущая подписка")).toBeVisible();
    await expect(page.getByText("Использование")).toBeVisible();
  });

  test("active subscription allows mutations", async ({ page }) => {
    const tagRes = await page.request.post("/api/tags", {
      data: { name: `e2e-billing-${Date.now()}`, color: "#2563eb" },
      headers: { "Content-Type": "application/json" },
    });
    expect([200, 201, 409]).toContain(tagRes.status());
  });
});
