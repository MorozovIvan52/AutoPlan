import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getCrmSettings } from "../lib/crm-settings";
import { listEnterprises } from "../lib/enterprises";

export const crmSettingsRoute = new Hono()
  .use("*", requireAuth)
  .get("/enterprises", async (c) => {
    const enterprises = await listEnterprises();
    return c.json({ enterprises }, 200);
  })
  .get("/", async (c) => {
    const settings = await getCrmSettings();
    return c.json({ settings }, 200);
  })
  .patch("/", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);

    const body = await c.req.json();
    const current = await getCrmSettings();

    const threshold = body.avitoAdvanceThresholdRub ?? current.avitoAdvanceThresholdRub ?? 200;
    const [updated] = await db.update(schema.crmSettings).set({
      avitoAutoDeals: body.avitoAutoDeals ?? current.avitoAutoDeals,
      avitoAdvanceAlertEnabled: body.avitoAdvanceAlertEnabled ?? current.avitoAdvanceAlertEnabled,
      avitoAdvanceThresholdRub: Math.max(50, Math.min(10_000, Number(threshold) || 200)),
      advanceAlertTelegramChatId: body.advanceAlertTelegramChatId !== undefined
        ? (body.advanceAlertTelegramChatId || null)
        : current.advanceAlertTelegramChatId,
      companyName: body.companyName !== undefined ? (body.companyName?.trim() || null) : current.companyName,
      companyAddress: body.companyAddress !== undefined ? (body.companyAddress?.trim() || null) : current.companyAddress,
      companyPhone: body.companyPhone !== undefined ? (body.companyPhone?.trim() || null) : current.companyPhone,
      companyInn: body.companyInn !== undefined ? (body.companyInn?.trim() || null) : current.companyInn,
      companyKpp: body.companyKpp !== undefined ? (body.companyKpp?.trim() || null) : current.companyKpp,
      companyBank: body.companyBank !== undefined ? (body.companyBank?.trim() || null) : current.companyBank,
      companyBik: body.companyBik !== undefined ? (body.companyBik?.trim() || null) : current.companyBik,
      companyRs: body.companyRs !== undefined ? (body.companyRs?.trim() || null) : current.companyRs,
      companyKs: body.companyKs !== undefined ? (body.companyKs?.trim() || null) : current.companyKs,
      vatMode: body.vatMode !== undefined ? (body.vatMode || "with_vat_20") : current.vatMode,
      sbpPayPayload: body.sbpPayPayload !== undefined ? (body.sbpPayPayload?.trim() || null) : current.sbpPayPayload,
      warrantyTemplates: body.warrantyTemplates !== undefined ? (body.warrantyTemplates || null) : current.warrantyTemplates,
      receiptShowArticles: body.receiptShowArticles !== undefined
        ? !!body.receiptShowArticles
        : (current.receiptShowArticles ?? true),
      updatedAt: new Date(),
    }).where(eq(schema.crmSettings.id, current.id)).returning();

    return c.json({ settings: updated }, 200);
  });
