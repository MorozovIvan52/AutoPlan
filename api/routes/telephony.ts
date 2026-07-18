import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { getPublicUrl } from "../lib/config";
import {
  getTelephonySettings,
  findClientByPhone,
  findUserByExtension,
  upsertCallLog,
  notifyIncomingCall,
} from "../lib/telephony/common";
import { maybeCreateAutoDealFromCall } from "../lib/auto-deals";
import { megafonMakeCall } from "../lib/telephony/megafon";
import { mtsMakeCallback } from "../lib/telephony/mts";

function maskToken(token?: string | null) {
  if (!token) return null;
  if (token.length <= 8) return "••••••••";
  return token.slice(0, 4) + "••••" + token.slice(-4);
}

export const telephony = new Hono()
  .use("*", requireAuth)
  .get("/status", async (c) => {
    const settings = await getTelephonySettings();
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    return c.json({
      enabled: settings.enabled,
      provider: settings.provider,
      hasMegafon: Boolean(settings.megafonApiUrl && settings.megafonToken),
      hasMts: Boolean(settings.mtsApiKey && settings.mtsAppId),
      userExtension: user?.phoneExtension || null,
      webhookUrls: {
        megafon: `${getPublicUrl()}/api/webhooks/telephony/megafon`,
        mts: `${getPublicUrl()}/api/webhooks/telephony/mts`,
      },
    }, 200);
  })
  .get("/settings", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);

    const settings = await getTelephonySettings();
    return c.json({
      settings: {
        ...settings,
        megafonToken: maskToken(settings.megafonToken),
        mtsApiKey: maskToken(settings.mtsApiKey),
        webhookUrls: {
          megafon: `${getPublicUrl()}/api/webhooks/telephony/megafon`,
          mts: `${getPublicUrl()}/api/webhooks/telephony/mts`,
        },
      },
    }, 200);
  })
  .patch("/settings", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);

    const body = await c.req.json();
    const current = await getTelephonySettings();

    const [updated] = await db.update(schema.telephonySettings).set({
      provider: body.provider ?? current.provider,
      enabled: body.enabled ?? current.enabled,
      megafonApiUrl: body.megafonApiUrl ?? current.megafonApiUrl,
      megafonToken: body.megafonToken && !body.megafonToken.includes("••••")
        ? body.megafonToken : current.megafonToken,
      mtsApiKey: body.mtsApiKey && !body.mtsApiKey.includes("••••")
        ? body.mtsApiKey : current.mtsApiKey,
      mtsAppId: body.mtsAppId ?? current.mtsAppId,
      mtsRedirectNumber: body.mtsRedirectNumber ?? current.mtsRedirectNumber,
      webhookSecret: body.webhookSecret ?? current.webhookSecret,
      callLoadBalanceEnabled: body.callLoadBalanceEnabled ?? current.callLoadBalanceEnabled,
      callLoadBalanceUserIds: body.callLoadBalanceUserIds !== undefined
        ? (Array.isArray(body.callLoadBalanceUserIds)
          ? JSON.stringify(body.callLoadBalanceUserIds)
          : body.callLoadBalanceUserIds)
        : current.callLoadBalanceUserIds,
      updatedAt: new Date(),
    }).where(eq(schema.telephonySettings.id, current.id)).returning();

    return c.json({
      settings: {
        ...updated,
        megafonToken: maskToken(updated.megafonToken),
        mtsApiKey: maskToken(updated.mtsApiKey),
      },
    }, 200);
  })
  .post("/call", async (c) => {
    const body = await c.req.json();
    const phone = (body.phone || "").trim();
    if (!phone) return c.json({ error: "Укажите телефон" }, 400);

    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const settings = await getTelephonySettings();
    const client = await findClientByPhone(phone);

    if (!settings.enabled || settings.provider === "none") {
      return c.json({ error: "Телефония не настроена", fallbackTel: true }, 400);
    }

    if (settings.provider === "megafon") {
      if (!settings.megafonApiUrl || !settings.megafonToken) {
        return c.json({ error: "Заполните настройки Мегафон ВАТС" }, 400);
      }
      const ext = user?.phoneExtension;
      if (!ext) return c.json({ error: "Укажите внутренний номер (добавочный) в профиле оператора" }, 400);

      await megafonMakeCall(settings.megafonApiUrl, settings.megafonToken, ext, phone);
      const call = await upsertCallLog({
        phone,
        direction: "outbound",
        provider: "megafon",
        clientId: client?.id ?? body.clientId ?? null,
        userId,
        operatorExt: ext,
        status: "ringing",
      });
      return c.json({ ok: true, call, mode: "megafon" }, 200);
    }

    if (settings.provider === "mts") {
      if (!settings.mtsApiKey || !settings.mtsAppId) {
        return c.json({ error: "Заполните настройки МТС Exolve" }, 400);
      }
      const operatorPhone = user?.phoneExtension || settings.mtsRedirectNumber;
      if (!operatorPhone) {
        return c.json({ error: "Укажите мобильный номер оператора (добавочный в профиле) или номер переадресации в настройках" }, 400);
      }

      const result = await mtsMakeCallback(settings.mtsApiKey, settings.mtsAppId, operatorPhone, phone);
      const call = await upsertCallLog({
        phone,
        direction: "outbound",
        provider: "mts",
        externalId: (result as any)?.call_id || null,
        clientId: client?.id ?? body.clientId ?? null,
        userId,
        status: "ringing",
      });
      return c.json({ ok: true, call, mode: "mts", result }, 200);
    }

    return c.json({ error: "Неизвестный провайдер" }, 400);
  })
  .post("/test-incoming", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);

    const body = await c.req.json().catch(() => ({}));
    const phone = (body.phone || "+7 900 000-00-00").trim();
    const client = await findClientByPhone(phone);

    const call = await upsertCallLog({
      phone,
      direction: "inbound",
      provider: "manual",
      clientId: client?.id ?? null,
      userId,
      status: "ringing",
    });

    const auto = await maybeCreateAutoDealFromCall({
      phone,
      clientId: client?.id ?? null,
      clientName: client?.name,
      assignedUserId: userId,
      callId: call.id,
    });

    await notifyIncomingCall({
      phone,
      clientId: auto.clientId || client?.id,
      clientName: client?.name,
      userId,
      callId: call.id,
    });

    return c.json({ ok: true, call, dealId: auto.dealId }, 200);
  });
