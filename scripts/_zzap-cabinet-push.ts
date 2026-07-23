/**
 * Force-refresh ZZap price templates via seller cabinet (external URL mode).
 * Runs on VPS with Chromium.
 */
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";

type Meta = {
  login: string;
  password: string;
  urls: { id: number; name: string; code: number; url: string }[];
};

async function main() {
  const meta = JSON.parse(readFileSync("/tmp/zzap-push-meta.json", "utf8")) as Meta;
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  const log: string[] = [];
  const note = (m: string) => {
    log.push(m);
    console.log(m);
  };

  try {
    // Seller login
    await page.goto("https://www.zzap.ru/", { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);

    // Try common login entry points
    const loginCandidates = [
      "https://www.zzap.ru/user/login",
      "https://www.zzap.ru/login",
      "https://www.zzap.ru/Auth/Login",
      "https://zzap.ru/user/login",
    ];
    let loggedIn = false;
    for (const u of loginCandidates) {
      try {
        await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 });
        note(`open ${u} title=${await page.title()} url=${page.url()}`);
        const email = page.locator('input[type="email"], input[name="email"], input[name="login"], input[name="Login"], #email, #login').first();
        const pass = page.locator('input[type="password"], input[name="password"], input[name="Password"], #password').first();
        if (await email.count() && await pass.count()) {
          await email.fill(meta.login);
          await pass.fill(meta.password);
          const btn = page.locator('button[type="submit"], input[type="submit"], button:has-text("Войти"), a:has-text("Войти")').first();
          await btn.click({ timeout: 5000 }).catch(async () => {
            await pass.press("Enter");
          });
          await page.waitForTimeout(3000);
          note(`after login url=${page.url()}`);
          loggedIn = !/login/i.test(page.url());
          if (loggedIn) break;
        }
      } catch (e: any) {
        note(`login try fail ${u}: ${e.message}`);
      }
    }

    // Dump page for debug if needed
    writeFileSync("/tmp/zzap-after-login.html", await page.content());
    await page.screenshot({ path: "/tmp/zzap-after-login.png", fullPage: true }).catch(() => {});

    // Seller / price templates areas
    const sellerUrls = [
      "https://www.zzap.ru/seller",
      "https://www.zzap.ru/seller/prices",
      "https://www.zzap.ru/seller/pricelists",
      "https://www.zzap.ru/cabinet",
      "https://www.zzap.ru/cabinet/prices",
      "https://www.zzap.ru/Seller/PriceTemplates",
      "https://www.zzap.ru/seller/templates",
      "https://b52.zzap.pro/",
      "https://www.zzap.ru/my",
    ];

    for (const u of sellerUrls) {
      try {
        const res = await page.goto(u, { waitUntil: "domcontentloaded", timeout: 20000 });
        note(`seller ${u} -> ${res?.status()} ${page.url()} title=${await page.title()}`);
      } catch (e: any) {
        note(`seller fail ${u}: ${e.message}`);
      }
    }

    // Search page for template codes / update buttons
    const bodyText = await page.locator("body").innerText().catch(() => "");
    note(`body_snip=${bodyText.slice(0, 500).replace(/\s+/g, " ")}`);

    // Click anything that looks like refresh/update price
    const refreshButtons = page.locator(
      'button:has-text("Обновить"), a:has-text("Обновить"), button:has-text("Загрузить"), a:has-text("Загрузить"), button:has-text("Обновить прайс"), a:has-text("Обновить прайс")',
    );
    const count = await refreshButtons.count();
    note(`refresh_buttons=${count}`);
    for (let i = 0; i < Math.min(count, 20); i++) {
      try {
        await refreshButtons.nth(i).click({ timeout: 3000 });
        await page.waitForTimeout(2000);
        note(`clicked refresh #${i}`);
      } catch (e: any) {
        note(`click fail #${i}: ${e.message}`);
      }
    }

    writeFileSync("/tmp/zzap-push-log.txt", log.join("\n"));
    console.log("DONE loggedIn=", loggedIn);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
