import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";

test.describe("Inbox UI stability", () => {
  test("portals and polling do not trigger insertBefore", async ({ page }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    await loginAsE2eUser(page);

    await expect(page.getByTestId("conversation-list")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("chat-panel")).toBeVisible();

    await page.getByTestId("notification-bell").click();
    await expect(page.locator("#notif-dropdown-panel")).toBeVisible();

    for (let i = 0; i < 3; i++) {
      await page.waitForTimeout(16_000);
      await expect(page.getByText("Ошибка интерфейса")).toHaveCount(0);
      await expect(page.getByTestId("conversation-list")).toBeVisible();
      await expect(page.getByTestId("chat-panel")).toBeVisible();
    }

    const allErrors = [...pageErrors, ...consoleErrors];
    const insertBefore = allErrors.filter((e) => e.includes("insertBefore"));
    expect(insertBefore, `insertBefore errors: ${insertBefore.join("; ")}`).toHaveLength(0);
  });
});
