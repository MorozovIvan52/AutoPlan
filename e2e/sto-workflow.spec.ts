import { test, expect } from "@playwright/test";
import { loginAsE2eUser } from "./helpers/auth";

test.describe("STO workflow smoke", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsE2eUser(page);
  });

  test("ЗН → товарный чек → проведение", async ({ page }) => {
    const clientsRes = await page.request.get("/api/clients");
    expect(clientsRes.ok()).toBeTruthy();
    const { clients } = await clientsRes.json() as { clients: { id: number }[] };
    const clientId = clients[0]?.id;
    expect(clientId).toBeTruthy();

    const dealRes = await page.request.post("/api/deals", {
      data: {
        clientId,
        title: `E2E ЗН ${Date.now()}`,
        orderType: "service",
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(dealRes.ok()).toBeTruthy();
    const { deal } = await dealRes.json() as { deal: { id: number } };

    await page.request.post(`/api/orders/${deal.id}/labor`, {
      data: { name: "Диагностика", normHours: 1, price: 1500 },
      headers: { "Content-Type": "application/json" },
    });

    await page.request.post(`/api/orders/${deal.id}/items`, {
      data: { name: "Масло 5W-30", article: "E2E-OIL", qty: 1, price: 800, partSource: "stock" },
      headers: { "Content-Type": "application/json" },
    });

    const salesRes = await page.request.post("/api/sales", {
      data: { docType: "receipt", dealId: deal.id },
      headers: { "Content-Type": "application/json" },
    });
    expect(salesRes.status()).toBe(201);
    const salesBody = await salesRes.json() as { doc: { id: number }; items: unknown[] };
    expect(salesBody.items.length).toBeGreaterThanOrEqual(2);

    const postRes = await page.request.post(`/api/sales/${salesBody.doc.id}/post`, {
      data: { paymentMethod: "cash" },
      headers: { "Content-Type": "application/json" },
    });
    expect(postRes.ok()).toBeTruthy();
    const posted = await postRes.json() as { doc: { status: string }; integrations?: { ofd?: { status: string } } };
    expect(posted.doc.status).toBe("posted");
    expect(posted.integrations).toBeDefined();
  });

  test("инвентаризация — сессия", async ({ page }) => {
    const res = await page.request.post("/api/sto/inventory/sessions", {
      data: { title: `E2E инвентаризация ${Date.now()}` },
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status()).toBe(201);
    const body = await res.json() as { session: { id: number; status: string } };
    expect(body.session.id).toBeGreaterThan(0);
    expect(body.session.status).toBe("draft");
  });

  test("проценка → заказ поставщику", async ({ page }) => {
    const orderRes = await page.request.post("/api/supplier-orders", {
      data: {
        supplierSlug: "manual",
        supplierName: "E2E поставщик",
        article: `E2E-${Date.now()}`,
        name: "Фильтр масляный",
        qty: 2,
        price: 450,
      },
      headers: { "Content-Type": "application/json" },
    });
    expect(orderRes.status()).toBe(201);
    const { order } = await orderRes.json() as { order: { id: number; status: string } };
    expect(order.status).toBe("draft");

    const patchRes = await page.request.patch(`/api/supplier-orders/${order.id}`, {
      data: { status: "ordered" },
      headers: { "Content-Type": "application/json" },
    });
    expect(patchRes.ok()).toBeTruthy();
    const updated = await patchRes.json() as { order: { status: string } };
    expect(updated.order.status).toBe("ordered");
  });
});
