import { Hono } from "hono";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { getIntegrationStatus } from "../integrations/onec";
import { pushDocumentTo1C, registerCashReceipt, type FiscalReceiptPayload } from "../integrations/onec";
import { getCrmSettings, patchCrmSettings } from "../lib/crm-settings";

export const integrationsRoute = new Hono()
  .use("*", requireAuth)

  .get("/status", async (c) => {
    return c.json(await getIntegrationStatus());
  })

  .get("/settings", requireAdmin, async (c) => {
    const s = await getCrmSettings();
    const row = s as Record<string, unknown>;
    return c.json({
      onecEnabled: Boolean(row.onecEnabled),
      onecUrl: row.onecUrl || "",
      ofdEnabled: Boolean(row.ofdEnabled),
      ofdProvider: row.ofdProvider || "atol",
      ofdGroupCode: row.ofdGroupCode || "",
      hasOnecToken: Boolean(row.onecToken),
      hasOfdToken: Boolean(row.ofdToken),
    });
  })

  .patch("/settings", requireAdmin, async (c) => {
    const body = await c.req.json();
    const patch: Record<string, unknown> = {};
    if (body.onecEnabled !== undefined) patch.onecEnabled = Boolean(body.onecEnabled);
    if (body.onecUrl !== undefined) patch.onecUrl = String(body.onecUrl || "").trim() || null;
    if (body.onecToken !== undefined) patch.onecToken = String(body.onecToken || "").trim() || null;
    if (body.ofdEnabled !== undefined) patch.ofdEnabled = Boolean(body.ofdEnabled);
    if (body.ofdProvider !== undefined) patch.ofdProvider = String(body.ofdProvider || "atol");
    if (body.ofdToken !== undefined) patch.ofdToken = String(body.ofdToken || "").trim() || null;
    if (body.ofdGroupCode !== undefined) patch.ofdGroupCode = String(body.ofdGroupCode || "").trim() || null;
    const updated = await patchCrmSettings(patch);
    return c.json({ ok: true, settings: updated });
  })

  .post("/test/onec", requireAdmin, async (c) => {
    const sample: FiscalReceiptPayload = {
      docId: 0,
      docNumber: "TEST-001",
      docType: "receipt",
      total: 100,
      paymentMethod: "cash",
      items: [{ name: "Тестовая позиция", qty: 1, price: 100, sum: 100 }],
    };
    const r = await pushDocumentTo1C(sample);
    return c.json(r, r.ok ? 200 : 502);
  })

  .post("/test/ofd", requireAdmin, async (c) => {
    const sample: FiscalReceiptPayload = {
      docId: 0,
      docNumber: "TEST-001",
      docType: "receipt",
      total: 1,
      paymentMethod: "cash",
      items: [{ name: "Тест", qty: 1, price: 1, sum: 1 }],
    };
    const r = await registerCashReceipt(sample);
    return c.json(r, r.ok ? 200 : 502);
  });
