import { chromium } from "playwright";
import { writeFileSync, readFileSync } from "fs";

async function main() {
  const meta = JSON.parse(readFileSync("/tmp/zzap-push-meta.json", "utf8"));
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/usr/bin/chromium-browser",
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
  });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    locale: "ru-RU",
  });
  const page = await context.newPage();

  await page.goto("https://www.zzap.ru/", { waitUntil: "domcontentloaded", timeout: 60000 });
  console.log("t0", page.url(), await page.title());

  // Wait for JS challenge to pass (up to 45s)
  for (let i = 0; i < 45; i++) {
    await page.waitForTimeout(1000);
    const title = await page.title();
    const html = await page.content();
    if (!/проверк/i.test(title) && !/js-challenge|проверк/i.test(html.slice(0, 2000))) {
      console.log("PASSED", i, page.url(), title);
      break;
    }
    if (i % 5 === 0) console.log("waiting challenge", i, title);
  }

  writeFileSync("/tmp/zzap-after-challenge.html", await page.content());
  await page.screenshot({ path: "/tmp/zzap-after-challenge.png", fullPage: true }).catch(() => {});
  console.log("final", page.url(), await page.title());

  // Try open login modal / link
  const login = page.getByText(/войти/i).first();
  if (await login.count()) {
    await login.click();
    await page.waitForTimeout(2000);
  }

  const email = page.locator("input").filter({ hasNot: page.locator('[type="hidden"]') });
  const inputs = await page.locator('input:visible').all();
  console.log("visible_inputs", inputs.length);
  for (const inp of inputs) {
    const t = await inp.getAttribute("type");
    const n = await inp.getAttribute("name");
    const p = await inp.getAttribute("placeholder");
    console.log("input", t, n, p);
  }

  const pass = page.locator('input[type="password"]:visible').first();
  const user = page.locator('input[type="email"]:visible, input[type="text"]:visible').first();
  if (await pass.count() && await user.count()) {
    await user.fill(meta.login);
    await pass.fill(meta.password);
    await page.locator('button:visible').filter({ hasText: /войти/i }).first().click().catch(async () => {
      await pass.press("Enter");
    });
    await page.waitForTimeout(5000);
    console.log("logged?", page.url(), await page.title());
    writeFileSync("/tmp/zzap-logged2.html", await page.content());
    await page.screenshot({ path: "/tmp/zzap-logged2.png", fullPage: true }).catch(() => {});

    // Go to price lists - try common SPA hashes/paths after login
    const targets = [
      "https://www.zzap.ru/#/account/prices",
      "https://www.zzap.ru/#/seller/prices",
      "https://www.zzap.ru/account/prices",
      "https://www.zzap.ru/Account/PriceLists",
    ];
    for (const u of targets) {
      await page.goto(u, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(2000);
      console.log("nav", u, "->", page.url(), await page.title());
    }

    // Click update for each template code text
    for (const item of meta.urls) {
      const codeText = String(item.code);
      const row = page.getByText(codeText).first();
      if (await row.count()) {
        console.log("found code", codeText);
        // click nearby update
        const parent = row.locator("xpath=ancestor::*[self::tr or self::div][1]");
        const btn = parent.locator('button, a, input').filter({ hasText: /обновить|загрузить/i }).first();
        if (await btn.count()) {
          await btn.click();
          await page.waitForTimeout(3000);
          console.log("clicked update for", codeText);
        }
      } else {
        console.log("code not on page", codeText);
      }
    }
  } else {
    console.log("NO_LOGIN_FORM");
  }

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
