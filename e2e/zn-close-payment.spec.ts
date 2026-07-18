import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";

test.describe("ЗН close-with-payment", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2eUser(page);
  });

  test("полная оплата списывает склад и ставит paid", async ({ page }) => {
    const clientsRes = await page.request.get("/api/clients");
    expect(clientsRes.ok()).toBeTruthy();
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;
    expect(clientId).toBeTruthy();

    const article = `E2E-CLOSE-${Date.now()}`;
    const partRes = await page.request.post("/api/parts", {
      data: {
        name: "E2E Close Part",
        article,
        brand: "E2E",
        qty: 10,
        price: 1500,
        purchasePrice: 800,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(partRes.ok()).toBeTruthy();
    const { part } = await partRes.json() as { part: { id: number; qty: number } };
    expect(part.id).toBeTruthy();

    const dealRes = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E close pay ${Date.now()}`,
        orderType: "service",
        status: "ready",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(dealRes.ok()).toBeTruthy();
    const { deal } = await dealRes.json() as { deal: { id: number } };

    const itemRes = await page.request.post(`/api/orders/${deal.id}/items`, {
      data: {
        name: "E2E Close Part",
        article,
        brand: "E2E",
        qty: 2,
        price: 1500,
        partSource: "stock",
        stockPartId: part.id,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(itemRes.ok()).toBeTruthy();

    const closeRes = await page.request.post(`/api/sto/deals/${deal.id}/close-with-payment`, {
      data: {
        paymentAmount: 3000,
        paymentMethod: "cash",
        setStatusDone: true,
        allowPartial: true,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(closeRes.ok()).toBeTruthy();
    const closeBody = await closeRes.json() as {
      deal: { paymentStatus: string; paidAmount: number; status: string | null };
      debt: number;
      stock: { deducted: number; skippedNoStockPartId: number };
      idempotent?: boolean;
    };
    expect(closeBody.idempotent).toBeFalsy();
    expect(closeBody.deal.paymentStatus).toBe("paid");
    expect(closeBody.deal.paidAmount).toBe(3000);
    expect(closeBody.debt).toBe(0);
    expect(closeBody.stock.deducted).toBeGreaterThanOrEqual(1);
    expect(closeBody.deal.status).toBe("done");

    const stockList = await page.request.get(`/api/parts?search=${encodeURIComponent(article)}`);
    expect(stockList.ok()).toBeTruthy();
    const { parts } = await stockList.json() as { parts: { id: number; qty: number }[] };
    const updated = parts.find((p) => p.id === part.id);
    expect(updated?.qty).toBe(8);

    const again = await page.request.post(`/api/sto/deals/${deal.id}/close-with-payment`, {
      data: { paymentAmount: 100, paymentMethod: "cash" },
      headers: { "Content-Type": "application/json" },
    });
    expect(again.ok()).toBeTruthy();
    const againBody = await again.json() as { idempotent?: boolean; debt: number };
    expect(againBody.idempotent).toBeTruthy();
    expect(againBody.debt).toBe(0);
  });

  test("частичная оплата оставляет partial и долг", async ({ page }) => {
    const clientsRes = await page.request.get("/api/clients");
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;
    expect(clientId).toBeTruthy();

    const dealRes = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E partial pay ${Date.now()}`,
        orderType: "service",
        status: "in_progress",
      },
      headers: { "Content-Type": "application/json" },
    });
    const { deal } = await dealRes.json() as { deal: { id: number } };

    await page.request.post(`/api/orders/${deal.id}/items`, {
      data: { name: "Работа без склада", qty: 1, price: 5000, partSource: "order" },
      headers: { "Content-Type": "application/json" },
    });

    const payRes = await page.request.post(`/api/sto/deals/${deal.id}/payments`, {
      data: { paymentAmount: 2000, paymentMethod: "card", allowPartial: true },
      headers: { "Content-Type": "application/json" },
    });
    expect(payRes.ok()).toBeTruthy();
    const body = await payRes.json() as {
      deal: { paymentStatus: string; paidAmount: number; status: string | null };
      debt: number;
      stock: { skippedNoStockPartId: number };
    };
    expect(body.deal.paymentStatus).toBe("partial");
    expect(body.deal.paidAmount).toBe(2000);
    expect(body.debt).toBe(3000);
    expect(body.deal.status).not.toBe("done");
    expect(body.stock.skippedNoStockPartId).toBeGreaterThanOrEqual(0);
  });

  test("day-board отдаёт колонки и фильтры", async ({ page }) => {
    const date = new Date().toISOString().slice(0, 10);
    const res = await page.request.get(`/api/sto/day-board?date=${date}&openOnly=1`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json() as {
      date: string;
      columns: Record<string, unknown[]>;
      filters: { openOnly: boolean };
    };
    expect(body.date).toBe(date);
    expect(body.columns.queue).toBeDefined();
    expect(body.columns.ready).toBeDefined();
    expect(body.filters.openOnly).toBe(true);
  });
});
