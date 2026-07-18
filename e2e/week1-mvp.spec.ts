import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";

const TEST_VIN = "WBADT43452G123456";

test.describe("Week 1 MVP", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2eUser(page);
  });

  test("история запчастей по VIN", async ({ page }) => {
    const clientsRes = await page.request.get("/api/clients");
    expect(clientsRes.ok()).toBeTruthy();
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;
    expect(clientId).toBeTruthy();

    const dealRes = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E VIN history ${Date.now()}`,
        orderType: "service",
        vin: TEST_VIN,
        status: "done",
        mileage: 120000,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(dealRes.ok()).toBeTruthy();
    const { deal } = await dealRes.json() as { deal: { id: number } };

    await page.request.post(`/api/orders/${deal.id}/items`, {
      data: { name: "Колодки передние", article: "E2E-BRK", qty: 1, price: 3200, partSource: "stock" },
      headers: { "Content-Type": "application/json" },
    });

    // вторая позиция с тем же артикулом — для recommendations
    const deal2Res = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E VIN history 2 ${Date.now()}`,
        orderType: "service",
        vin: TEST_VIN,
        status: "done",
        mileage: 130000,
      },
      headers: { "Content-Type": "application/json" },
    });
    const { deal: deal2 } = await deal2Res.json() as { deal: { id: number } };
    await page.request.post(`/api/orders/${deal2.id}/items`, {
      data: { name: "Колодки передние", article: "E2E-BRK", qty: 1, price: 3300, partSource: "stock" },
      headers: { "Content-Type": "application/json" },
    });

    const historyRes = await page.request.get(`/api/vehicles/${TEST_VIN}/parts-history`);
    expect(historyRes.ok()).toBeTruthy();
    const history = await historyRes.json() as {
      vin: string;
      items: { name: string; itemType: string; mileage: number | null }[];
      recommendations: { name: string; timesSeen: number }[];
    };
    expect(history.vin).toBe(TEST_VIN);
    expect(history.items.length).toBeGreaterThanOrEqual(1);
    expect(history.items.some((i) => i.name.includes("Колодки"))).toBeTruthy();
    expect(history.items.some((i) => i.mileage != null)).toBeTruthy();
    expect(Array.isArray(history.recommendations)).toBeTruthy();
    expect(history.recommendations.some((r) => r.name.includes("Колодки") && r.timesSeen >= 2)).toBeTruthy();

    const emptyRes = await page.request.get("/api/vehicles/UNKNOWNVIN123/parts-history");
    expect(emptyRes.ok()).toBeTruthy();
    const empty = await emptyRes.json() as { items: unknown[]; recommendations: unknown[] };
    expect(empty.items).toEqual([]);
    expect(empty.recommendations).toEqual([]);
  });

  test("статус ready — уведомление клиенту", async ({ page }) => {
    const clientsRes = await page.request.get("/api/clients");
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;
    expect(clientId).toBeTruthy();

    const createRes = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E ready notify ${Date.now()}`,
        orderType: "service",
        status: "in_progress",
      },
      headers: { "Content-Type": "application/json" },
    });
    const { deal } = await createRes.json() as { deal: { id: number } };

    const patchRes = await page.request.patch(`/api/deals/${deal.id}`, {
      data: { status: "ready" },
      headers: { "Content-Type": "application/json" },
    });
    expect(patchRes.ok()).toBeTruthy();
    const body = await patchRes.json() as { deal: { status: string }; notify: { ok: boolean } | null };
    expect(body.deal.status).toBe("ready");
    expect(body.notify).toBeDefined();
  });

  test("экспорт CSV — clients, work-orders, stock", async ({ page }) => {
    for (const path of ["/api/export/clients.csv", "/api/export/work-orders.csv", "/api/export/stock.csv"] as const) {
      const res = await page.request.get(path);
      expect(res.ok()).toBeTruthy();
      expect(res.headers()["content-type"] || "").toContain("text/csv");
      const text = await res.text();
      expect(text.length).toBeGreaterThan(10);
      if (path.includes("clients")) expect(text).toContain("id,name,phone");
      if (path.includes("work-orders")) expect(text).toContain("id,title,status");
      if (path.includes("stock")) expect(text).toContain("article");
    }
  });

  test("owner-dashboard метрики", async ({ page }) => {
    const res = await page.request.get("/api/sto/owner-dashboard");
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as { metrics: { bayLoadPercent: number; lowStockCount: number } };
    expect(body.metrics).toBeTruthy();
    expect(typeof body.metrics.bayLoadPercent).toBe("number");
    expect(typeof body.metrics.lowStockCount).toBe("number");
  });

  test("master work-session start/stop", async ({ page }) => {
    const clientsRes = await page.request.get("/api/clients");
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;

    const createRes = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E master session ${Date.now()}`,
        orderType: "service",
        status: "in_progress",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(createRes.ok()).toBeTruthy();
    const { deal } = await createRes.json() as { deal: { id: number } };

    const startRes = await page.request.post(`/api/sto/deals/${deal.id}/work-sessions`);
    expect(startRes.ok()).toBeTruthy();
    const startBody = await startRes.json() as { session: { id: number; endedAt: string | null } };
    expect(startBody.session?.id).toBeTruthy();
    expect(startBody.session.endedAt).toBeFalsy();

    const stopRes = await page.request.patch(`/api/sto/deals/${deal.id}/work-sessions/${startBody.session.id}`, {
      data: { action: "stop" },
      headers: { "Content-Type": "application/json" },
    });
    expect(stopRes.ok()).toBeTruthy();
    const stopBody = await stopRes.json() as { session: { endedAt: string | null } };
    expect(stopBody.session.endedAt).toBeTruthy();
  });
});
