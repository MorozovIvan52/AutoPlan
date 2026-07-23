/**
 * Полный аудит CRM «АвтоПлан» — все страницы, API, ЗН, чат, изоляция tenant.
 *
 * Локально (e2e БД):
 *   npm run test:e2e:audit
 *
 * VPS / demo pilot (полный доступ только sto-1/2/3):
 *   PLAYWRIGHT_BASE_URL=https://crmavito.online \
 *   PLAYWRIGHT_SKIP_WEBSERVER=1 \
 *   PILOT_AUDIT=1 \
 *   PILOT_TENANT_SLUG=sto-1 \
 *   PILOT_LOGIN=admin@sto1.demo \
 *   npx playwright test e2e/full-crm-audit.spec.ts
 */
import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";
import {
  loginAsPilotUser,
  loadPilotManifest,
  pilotAuditEnabled,
  tenantHeaders,
  API_GET_SMOKE,
  UI_ROUTES,
  PILOT_PASSWORD,
} from "./helpers/pilot-auth";

test.describe.configure({ mode: "serial" });

test.describe("Full CRM Audit", () => {
  test.beforeEach(async ({ page }) => {
    if (pilotAuditEnabled()) {
      await loginAsPilotUser(page);
    } else {
      await loginAsE2eUser(page);
    }
  });

  test("01 — все страницы UI открываются без падения", async ({ page }) => {
    const failures: string[] = [];

    for (const route of UI_ROUTES) {
      await page.goto(route.path);
      await page.waitForLoadState("networkidle").catch(() => {});

      const url = page.url();
      if (url.includes("/login")) {
        failures.push(`${route.name} (${route.path}): редирект на login`);
        continue;
      }

      const bodyText = await page.locator("body").innerText().catch(() => "");
      if (/internal server error|cannot get/i.test(bodyText)) {
        failures.push(`${route.name} (${route.path}): ошибка на странице`);
        continue;
      }

      if (bodyText.trim().length < 20) {
        failures.push(`${route.name} (${route.path}): пустая страница`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("02 — все основные GET API отвечают 200", async ({ page }) => {
    const tenantSlug = process.env.PILOT_TENANT_SLUG || "sto-1";
    const headers = tenantHeaders(tenantSlug);
    const failures: string[] = [];

    for (const path of API_GET_SMOKE) {
      const res = await page.request.get(path, { headers });
      if (!res.ok()) {
        failures.push(`${path} → HTTP ${res.status()}`);
      }
    }

    expect(failures, failures.join("\n")).toEqual([]);
  });

  test("03 — ЗН: создать → работа → запчасть → close-with-payment", async ({ page }) => {
    const tenantSlug = process.env.PILOT_TENANT_SLUG || "sto-1";
    const headers = { ...tenantHeaders(tenantSlug), "Content-Type": "application/json" };

    const clientsRes = await page.request.get("/api/clients", { headers: tenantHeaders(tenantSlug) });
    expect(clientsRes.ok()).toBeTruthy();
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;
    expect(clientId).toBeTruthy();

    const dealRes = await page.request.post("/api/deals", {
      headers,
      data: {
        clientId,
        title: `AUDIT ЗН ${Date.now()}`,
        orderType: "service",
        status: "in_progress",
      },
    });
    expect(dealRes.ok()).toBeTruthy();
    const { deal } = await dealRes.json() as { deal: { id: number } };

    const laborRes = await page.request.post(`/api/orders/${deal.id}/labor`, {
      headers,
      data: { name: "Диагностика AUDIT", normHours: 1, price: 2000 },
    });
    expect(laborRes.ok()).toBeTruthy();

    const partsRes = await page.request.get("/api/parts?limit=1", { headers: tenantHeaders(tenantSlug) });
    const { parts } = await partsRes.json() as { parts: { id: number; article: string; name: string; price: number }[] };
    const part = parts[0];
    expect(part).toBeTruthy();

    const itemRes = await page.request.post(`/api/orders/${deal.id}/items`, {
      headers,
      data: {
        name: part!.name,
        article: part!.article,
        qty: 1,
        price: part!.price,
        partSource: "stock",
        stockPartId: part!.id,
      },
    });
    expect(itemRes.ok()).toBeTruthy();

    const closeRes = await page.request.post(`/api/sto/deals/${deal.id}/close-with-payment`, {
      headers,
      data: {
        paymentAmount: 5000,
        paymentMethod: "cash",
        setStatusDone: true,
        allowPartial: true,
      },
    });
    expect(closeRes.ok()).toBeTruthy();
    const closeBody = await closeRes.json() as { deal: { status: string; paymentStatus: string } };
    expect(closeBody.deal.status).toBe("done");
    expect(closeBody.deal.paymentStatus).toBe("paid");
  });

  test("04 — чат: сообщения demo-диалога", async ({ page }) => {
    const manifest = loadPilotManifest();
    test.skip(!manifest && !pilotAuditEnabled(), "нет pilot manifest");

    const tenantSlug = process.env.PILOT_TENANT_SLUG || "sto-1";
    const convId = manifest?.tenants.find((t) => t.slug === tenantSlug)?.conversationId;

    if (!convId) {
      const convRes = await page.request.get("/api/conversations", { headers: tenantHeaders(tenantSlug) });
      const { conversations } = await convRes.json() as { conversations: { id: number }[] };
      expect(conversations?.[0]?.id).toBeTruthy();
      const id = conversations![0]!.id;
      const msgRes = await page.request.get(`/api/conversations/${id}/messages`, { headers: tenantHeaders(tenantSlug) });
      expect(msgRes.ok()).toBeTruthy();
      const { messages } = await msgRes.json() as { messages: unknown[] };
      expect(messages.length).toBeGreaterThan(0);
      return;
    }

    const msgRes = await page.request.get(`/api/conversations/${convId}/messages`, {
      headers: tenantHeaders(tenantSlug),
    });
    expect(msgRes.ok()).toBeTruthy();
    const { messages } = await msgRes.json() as { messages: { text: string }[] };
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some((m) => /vin/i.test(m.text))).toBeTruthy();
  });

  test("05 — склад: список и race-запчасть не в минусе", async ({ page }) => {
    const tenantSlug = process.env.PILOT_TENANT_SLUG || "sto-1";
    const headers = tenantHeaders(tenantSlug);
    const manifest = loadPilotManifest();
    const raceArticle = manifest?.tenants.find((t) => t.slug === tenantSlug)?.racePartArticle || "PILOT-1-RACE";

    const res = await page.request.get(`/api/parts?search=${encodeURIComponent(raceArticle)}`, { headers });
    expect(res.ok()).toBeTruthy();
    const { parts } = await res.json() as { parts: { qty: number; article: string }[] };
    const race = parts.find((p) => p.article === raceArticle);
    if (race) {
      expect(race.qty).toBeGreaterThanOrEqual(0);
    }
  });

  test("06 — товарный чек / sales", async ({ page }) => {
    const tenantSlug = process.env.PILOT_TENANT_SLUG || "sto-1";
    const headers = tenantHeaders(tenantSlug);

    const res = await page.request.get("/api/sales", { headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { documents?: unknown[]; docs?: unknown[] };
    const docs = body.documents || body.docs || [];
    expect(Array.isArray(docs)).toBeTruthy();
  });

  test("07 — изоляция tenant (pilot only)", async ({ page }) => {
    const manifest = loadPilotManifest();
    test.skip(!manifest, "нет pilot manifest — пропуск изоляции");

    const sto1 = manifest!.tenants.find((t) => t.slug === "sto-1");
    const sto2 = manifest!.tenants.find((t) => t.slug === "sto-2");
    expect(sto1 && sto2).toBeTruthy();

    await loginAsPilotUser(page, { tenantSlug: "sto-1", email: "master@sto1.demo", password: PILOT_PASSWORD });

    const foreignDealId = sto2!.deals.draftId || sto2!.deals.closedId;
    const res = await page.request.get(`/api/deals/${foreignDealId}`, {
      headers: tenantHeaders("sto-2"),
    });
    expect([403, 404]).toContain(res.status());
  });

  test("08 — UI: страница заказов открывает список ЗН", async ({ page }) => {
    await page.goto("/deals");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(page.url()).not.toContain("/login");
    const content = await page.locator("body").innerText();
    expect(content.length).toBeGreaterThan(50);
  });

  test("09 — UI: склад открывается", async ({ page }) => {
    await page.goto("/warehouse");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(page.url()).not.toContain("/login");
  });

  test("10 — UI: продажи / чеки", async ({ page }) => {
    await page.goto("/sales");
    await page.waitForLoadState("networkidle").catch(() => {});
    expect(page.url()).not.toContain("/login");
  });
});
