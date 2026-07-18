import { Hono } from "hono";
import { requireAuth } from "../middleware/auth";
import { buildLicenseOfferText, getLicensorDetails, getLicensorReadiness, getOfferVersion } from "../lib/license-offer-text";
import {
  confirmOfferOtp,
  offerRequiredForUser,
  sendOfferOtp,
  tenantOfferAccepted,
} from "../lib/license-offer";
import { DEFAULT_TENANT_ID } from "../lib/tenant-bootstrap";

export const licenseOffer = new Hono()
  .use("*", requireAuth)

  .get("/status", async (c) => {
    const user = c.get("user") as { id: number; role?: string; tenantId?: number };
    const tenantId = user.tenantId ?? (c.get("tenantId") as number) ?? DEFAULT_TENANT_ID;
    const required = offerRequiredForUser(user);
    const accepted = required ? await tenantOfferAccepted(tenantId) : true;
    const readiness = getLicensorReadiness();
    return c.json({
      required,
      accepted,
      version: getOfferVersion(),
      licensor: getLicensorDetails(),
      licensorReady: readiness.ready,
      licensorMissing: readiness.missing,
      licensorStatus: readiness.status,
    }, 200);
  })

  .get("/text", async (c) => {
    const readiness = getLicensorReadiness();
    return c.json({
      version: getOfferVersion(),
      text: buildLicenseOfferText(),
      licensor: getLicensorDetails(),
      licensorReady: readiness.ready,
      licensorMissing: readiness.missing,
      licensorStatus: readiness.status,
    }, 200);
  })

  .post("/send-code", async (c) => {
    const user = c.get("user") as { id: number; role?: string; tenantId?: number };
    if (!offerRequiredForUser(user)) {
      return c.json({ error: "Для демо-аккаунта акцепт не требуется" }, 400);
    }
    const tenantId = user.tenantId ?? (c.get("tenantId") as number) ?? DEFAULT_TENANT_ID;
    if (await tenantOfferAccepted(tenantId)) {
      return c.json({ ok: true, alreadyAccepted: true }, 200);
    }
    const body = await c.req.json<{ phone?: string }>().catch(() => ({} as { phone?: string }));
    const result = await sendOfferOtp({
      tenantId,
      userId: user.id,
      phoneRaw: body.phone || "",
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({
      ok: true,
      phone: result.phone,
      ...(result.debugCode ? { debugCode: result.debugCode } : {}),
    }, 200);
  })

  .post("/confirm", async (c) => {
    const user = c.get("user") as { id: number; role?: string; tenantId?: number };
    if (!offerRequiredForUser(user)) {
      return c.json({ ok: true, skipped: true }, 200);
    }
    const tenantId = user.tenantId ?? (c.get("tenantId") as number) ?? DEFAULT_TENANT_ID;
    if (await tenantOfferAccepted(tenantId)) {
      return c.json({ ok: true, alreadyAccepted: true }, 200);
    }
    const body = await c.req.json<{ phone?: string; code?: string }>().catch(() => ({} as { phone?: string; code?: string }));
    const result = await confirmOfferOtp({
      tenantId,
      userId: user.id,
      phoneRaw: body.phone || "",
      code: body.code || "",
    });
    if (!result.ok) return c.json({ error: result.error }, 400);
    return c.json({ ok: true, version: getOfferVersion() }, 200);
  });
