import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "fs";

async function main() {
  const meta = JSON.parse(readFileSync("/tmp/zzap-push-meta.json", "utf8"));
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.on("response", async (res) => {
    const u = res.url();
    if (/login|auth|account|price|template|api/i.test(u) && res.status() < 500) {
      console.log("RESP", res.status(), u.slice(0, 160));
    }
  });

  await page.goto("https://www.zzap.ru/", { waitUntil: "networkidle", timeout: 60000 });
  console.log("HOME", page.url(), await page.title());
  writeFileSync("/tmp/zzap-home.html", await page.content());
  await page.screenshot({ path: "/tmp/zzap-home.png", fullPage: true }).catch(() => {});

  // Click Войти
  const loginLink = page.getByRole("link", { name: /войти/i }).first();
  if (await loginLink.count()) {
    await loginLink.click();
    await page.waitForTimeout(2000);
    console.log("AFTER_CLICK_LOGIN", page.url());
  } else {
    // try text
    const t = page.locator("text=Войти").first();
    if (await t.count()) {
      await t.click();
      await page.waitForTimeout(2000);
      console.log("AFTER_TEXT_LOGIN", page.url());
    }
  }

  writeFileSync("/tmp/zzap-login-ui.html", await page.content());
  await page.screenshot({ path: "/tmp/zzap-login-ui.png", fullPage: true }).catch(() => {});

  // Fill login if form visible
  const email = page.locator('input[type="email"], input[name*="mail" i], input[name*="login" i], input[placeholder*="mail" i], input[placeholder*="логин" i]').first();
  const pass = page.locator('input[type="password"]').first();
  console.log("email_count", await email.count(), "pass_count", await pass.count());
  if (await email.count() && await pass.count()) {
    await email.fill(meta.login);
    await pass.fill(meta.password);
    const submit = page.locator('button[type="submit"], input[type="submit"], button:has-text("Войти")').first();
    await submit.click().catch(async () => pass.press("Enter"));
    await page.waitForTimeout(4000);
    console.log("AFTER_LOGIN", page.url(), await page.title());
    writeFileSync("/tmp/zzap-logged.html", await page.content());
    await page.screenshot({ path: "/tmp/zzap-logged.png", fullPage: true }).catch(() => {});
  }

  // Navigate to price lists
  for (const name of [/Прайс-листы и шаблоны/i, /Прайс-листы/i, /Мой аккаунт/i, /шаблон/i]) {
    const el = page.getByText(name).first();
    if (await el.count()) {
      console.log("FOUND_TEXT", String(name));
      await el.click().catch(() => {});
      await page.waitForTimeout(2000);
      console.log("URL", page.url());
    }
  }

  // Links containing price/template
  const hrefs = await page.$$eval("a[href]", (as) =>
    as.map((a) => a.getAttribute("href")).filter((h) => h && /price|template|прайс|шаблон|account|cabinet/i.test(h)),
  );
  console.log("HREFS", JSON.stringify(hrefs.slice(0, 40)));

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
