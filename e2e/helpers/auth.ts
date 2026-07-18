import type { Page } from "@playwright/test";

export async function loginAsE2eUser(page: Page) {
  const email = process.env.E2E_LOGIN || "e2e@crm.local";
  const password = process.env.E2E_PASSWORD || "E2eTest123!";

  await page.goto("/login");
  await page.getByTestId("login-email").fill(email);
  await page.getByTestId("login-password").fill(password);
  await page.getByTestId("login-submit").click();
  await page.waitForURL((url) => !url.pathname.includes("/login"), { timeout: 30_000 });
}
