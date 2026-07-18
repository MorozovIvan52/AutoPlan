import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, or, and } from "drizzle-orm";
import { parseWebhook } from "../integrations";
import { parseWhatsAppStatus } from "../integrations/whatsapp";
import { updateDeliveryByExternalId } from "../lib/message-delivery";
import { ingestIncoming } from "../services/messaging";
import { parseConfig } from "../lib/channel-config";
import { extractChatClient, getAvitoMessageRole, isInvalidAvitoExternalId, isAvitoAccountLabel } from "../lib/avito-context";
import { isGenericClientName } from "../lib/client-enrich";
import { fetchAvitoChat } from "../integrations/avito";
import {
  getTelephonySettings,
  findClientByPhone,
  findUserByExtension,
  upsertCallLog,
  notifyIncomingCall,
  runTelephonyWebhook,
} from "../lib/telephony/common";
import {
  parseMegafonBody,
  isMegafonIncoming,
  isMegafonCompleted,
  isMegafonMissed,
} from "../lib/telephony/megafon";
import {
  parseMtsCaller,
  buildMtsFollowMeResponse,
  type MtsIncomingRequest,
} from "../lib/telephony/mts";
import { resolveIncomingCallRoute } from "../lib/telephony/routing";
import { maybeCreateAutoDealFromCall } from "../lib/auto-deals";
import { timingSafeEqualText, clientIp, checkWebhookRateLimit } from "../middleware/security";
import { isProduction, isPublicDeployment } from "../lib/env";
import { verifyChannelWebhookSecret } from "../lib/webhook-guard";
import { verifyWhatsAppSignature } from "../lib/whatsapp-signature";
import { verifyAvitoWebhookAuth } from "../lib/avito-signature";
import { runAsChannelTenant, getChannelInTenant, getChannelBySlugInTenant } from "../lib/tenant-guard";
import { runWithTenant } from "../lib/tenant-context";

async function parseFormOrJson(c: any): Promise<Record<string, string>> {
  const ct = c.req.header("content-type") || "";
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await c.req.text();
    const params = new URLSearchParams(text);
    const out: Record<string, string> = {};
    params.forEach((v, k) => { out[k] = v; });
    return out;
  }
  try {
    const json = await c.req.json();
    if (json && typeof json === "object") {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(json)) {
        if (typeof v === "string" || typeof v === "number") out[k] = String(v);
      }
      return out;
    }
  } catch { /* empty */ }
  return {};
}

export const webhooks = new Hono()
  .use("*", async (c, next) => {
    const ip = clientIp(c);
    const rl = checkWebhookRateLimit(ip);
    if (!rl.ok) {
      return c.json({ ok: false, error: "rate limit" }, 429, {
        "Retry-After": String(rl.retryAfterSec ?? 60),
      });
    }
    await next();
  })
  .post("/telegram/:channelId", async (c) => {
    const channelId = parseInt(c.req.param("channelId"));
    const channel = await getChannelInTenant(channelId);
    if (!channel || channel.type !== "telegram") return c.json({ ok: false }, 404);

    return runAsChannelTenant(channel, async () => {
    if (!verifyChannelWebhookSecret(c, channel, { requireInProduction: true })) {
      return c.json({ ok: false }, 403);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false }, 400);
    }

    const parsed = parseWebhook("telegram", body);
    if (!parsed) return c.json({ ok: true }, 200);

    if (parsed.externalMessageId) {
      const [conv] = await db.select().from(schema.conversations).where(
        and(
          eq(schema.conversations.externalChatId, parsed.externalChatId),
          eq(schema.conversations.channelType, channel.slug),
        ),
      ).limit(1);
      if (conv) {
        const [exists] = await db.select().from(schema.messages)
          .where(eq(schema.messages.externalMessageId, parsed.externalMessageId))
          .limit(1);
        if (exists) return c.json({ ok: true }, 200);
      }
    }

    await ingestIncoming({
      channelId: channel.id,
      channelSlug: channel.slug,
      channelType: channel.type,
      ...parsed,
    });

    return c.json({ ok: true }, 200);
    });
  })

  .post("/avito/:slug", async (c) => {
    const slug = c.req.param("slug");
    const [channel] = await db.select().from(schema.channels).where(
      or(eq(schema.channels.slug, slug), eq(schema.channels.slug, `avito_${slug}`)),
    );
    if (!channel || channel.type !== "avito") return c.json({ ok: false }, 404);

    const rawBody = await c.req.text();
    const config = parseConfig(channel.config);
    if (isPublicDeployment() && !config.webhookSecret?.trim()) {
      return c.json({ ok: false }, 403);
    }
    if (config.webhookSecret) {
      const ok = verifyAvitoWebhookAuth(rawBody, config.webhookSecret, {
        messengerSignature: c.req.header("x-avito-messenger-signature"),
        plainSecret: c.req.header("x-avito-secret") || c.req.header("x-webhook-secret"),
        queryToken: c.req.query("token"),
      });
      if (!ok) {
        console.warn(`[webhook/avito] ${channel.slug}: неверная подпись`);
        return c.json({ ok: false }, 403);
      }
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ ok: false }, 400);
    }

    const parsed = parseWebhook("avito", body);
    if (!parsed) return c.json({ ok: true }, 200);

    const accountUserId = String(config.userId || "");
    const value = body?.payload?.value ?? body?.value ?? body;
    const role = getAvitoMessageRole(value, accountUserId);
    if (!role) return c.json({ ok: true }, 200);

    let externalUserId = parsed.externalUserId;
    let senderName = parsed.senderName;

    const fromChat = extractChatClient(value?.chat ?? body?.chat, accountUserId);
    let buyerName = fromChat?.senderName;
    if (fromChat && !isAvitoAccountLabel(fromChat.senderName, channel.name)) {
      externalUserId = fromChat.externalUserId;
      if (role !== "operator") senderName = fromChat.senderName;
    } else if (role === "operator" || role === "system") {
      const chatId = parsed.externalChatId;
      const [conv] = await db.select().from(schema.conversations).where(
        and(
          eq(schema.conversations.externalChatId, chatId),
          eq(schema.conversations.channelType, channel.slug),
        ),
      ).limit(1);
      if (conv) {
        const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, conv.clientId));
        if (client?.externalId && !isInvalidAvitoExternalId(client.externalId)) {
          externalUserId = client.externalId;
          if (!isAvitoAccountLabel(client.name, channel.name)) {
            senderName = client.name;
          }
        }
      }
      if (role === "operator" && externalUserId === accountUserId) return c.json({ ok: true }, 200);
    }

    const needsBuyerLookup = role === "client"
      || isInvalidAvitoExternalId(externalUserId)
      || isAvitoAccountLabel(buyerName, channel.name)
      || isAvitoAccountLabel(senderName, channel.name);

    if (needsBuyerLookup) {
      const chatData = await fetchAvitoChat(config, parsed.externalChatId);
      const fromApi = chatData ? extractChatClient(chatData, accountUserId) : null;
      if (fromApi && !isAvitoAccountLabel(fromApi.senderName, channel.name)) {
        externalUserId = fromApi.externalUserId;
        buyerName = fromApi.senderName;
        if (role === "client") senderName = fromApi.senderName;
      }
    }

    if (role === "client") {
      const authorName = parsed.senderName?.trim();
      if (authorName
        && !isAvitoAccountLabel(authorName, channel.name)
        && !isGenericClientName(authorName, channel.name)) {
        senderName = authorName;
        if (!buyerName || isAvitoAccountLabel(buyerName, channel.name)) buyerName = authorName;
        if (!isInvalidAvitoExternalId(parsed.externalUserId) && parsed.externalUserId !== accountUserId) {
          externalUserId = parsed.externalUserId;
        }
      }
    }

    if (isInvalidAvitoExternalId(externalUserId) && role === "system") {
      const chatData = await fetchAvitoChat(config, parsed.externalChatId);
      const fromApi = extractChatClient(chatData, accountUserId);
      if (fromApi) {
        externalUserId = fromApi.externalUserId;
        senderName = fromApi.senderName;
        buyerName = fromApi.senderName;
      }
    }

    if (isInvalidAvitoExternalId(externalUserId)) return c.json({ ok: true }, 200);

    try {
    const result = await ingestIncoming({
        channelId: channel.id,
        channelSlug: channel.slug,
        channelType: channel.type,
        ...parsed,
        externalUserId,
        senderName,
        buyerName,
        senderType: role,
        countAsUnread: role === "client",
        avitoAccountName: channel.name,
      });
      if (!result) return c.json({ ok: true }, 200);
      console.log(`[webhook/avito] ${channel.slug}: сообщение ${result.message?.id ?? "?"}`);
    } catch (e: any) {
      console.error("[webhook/avito]", e.message);
      return c.json({ ok: true }, 200);
    }

    await db.update(schema.channels).set({ lastSyncAt: new Date() }).where(eq(schema.channels.id, channel.id));

    return c.json({ ok: true }, 200);
  })

  .post("/whatsapp/:slug", async (c) => {
    const slug = c.req.param("slug");
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.slug, slug));
    if (!channel || channel.type !== "whatsapp") return c.json({ ok: false }, 404);

    const rawBody = await c.req.text();
    const config = parseConfig(channel.config);
    const appSecret = config.appSecret?.trim();

    if (appSecret) {
      if (!verifyWhatsAppSignature(rawBody, c.req.header("x-hub-signature-256"), appSecret)) {
        return c.json({ ok: false }, 403);
      }
    } else if (!verifyChannelWebhookSecret(c, channel, { requireInProduction: true })) {
      return c.json({ ok: false }, 403);
    }

    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json({ ok: false }, 400);
    }

    const statusUpdate = parseWhatsAppStatus(body);
    if (statusUpdate) {
      await updateDeliveryByExternalId(statusUpdate.externalMessageId, statusUpdate.status);
      return c.json({ ok: true }, 200);
    }

    const parsed = parseWebhook("whatsapp", body);
    if (!parsed) return c.json({ ok: true }, 200);

    await ingestIncoming({
      channelId: channel.id,
      channelSlug: channel.slug,
      channelType: channel.type,
      ...parsed,
      phone: parsed.externalChatId,
    });
    return c.json({ ok: true }, 200);
  })

  .get("/whatsapp/:slug", async (c) => {
    const slug = c.req.param("slug");
    const mode = c.req.query("hub.mode");
    const token = c.req.query("hub.verify_token");
    const challenge = c.req.query("hub.challenge");
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.slug, slug));
    if (!channel) return c.text("Forbidden", 403);
    const config = parseConfig(channel.config);
    if (mode === "subscribe" && config.verifyToken && token && timingSafeEqualText(token, config.verifyToken)) {
      return c.text(challenge || "");
    }
    return c.text("Forbidden", 403);
  })

  .post("/max/:slug", async (c) => {
    const slug = c.req.param("slug");
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.slug, slug));
    if (!channel || channel.type !== "max") return c.json({ ok: false }, 404);

    if (!verifyChannelWebhookSecret(c, channel, {
      headerNames: ["x-max-bot-api-secret", "x-webhook-secret"],
      requireInProduction: true,
    })) {
      return c.json({ ok: false }, 403);
    }

    let body: any;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ ok: false }, 400);
    }

    const parsed = parseWebhook("max", body);
    if (!parsed) return c.json({ ok: true }, 200);

    if (parsed.externalMessageId) {
      const [exists] = await db.select().from(schema.messages)
        .where(eq(schema.messages.externalMessageId, parsed.externalMessageId))
        .limit(1);
      if (exists) return c.json({ ok: true }, 200);
    }

    await ingestIncoming({
      channelId: channel.id,
      channelSlug: channel.slug,
      channelType: channel.type,
      ...parsed,
    });
    return c.json({ ok: true }, 200);
  })

  .post("/vk/:slug", async (c) => {
    const slug = c.req.param("slug");
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.slug, slug));
    if (!channel || channel.type !== "vk") return c.json({ ok: false }, 404);

    const body = await c.req.json();
    if (body.type === "confirmation") {
      const config = parseConfig(channel.config);
      return c.text(config.confirmationCode || "ok");
    }

    if (!verifyChannelWebhookSecret(c, channel, { requireInProduction: true })) {
      return c.json({ ok: false }, 403);
    }

    const parsed = parseWebhook("vk", body);
    if (!parsed) return c.json({ ok: true }, 200);

    await ingestIncoming({
      channelId: channel.id,
      channelSlug: channel.slug,
      channelType: channel.type,
      ...parsed,
    });
    return c.json({ ok: true }, 200);
  })

  .post("/generic/:slug", async (c) => {
    const slug = c.req.param("slug");
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.slug, slug));
    if (!channel) return c.json({ ok: false }, 404);

    if (!verifyChannelWebhookSecret(c, channel, { requireInProduction: true })) {
      return c.json({ ok: false }, 403);
    }

    const body = await c.req.json();
    const text = body.text || body.message || JSON.stringify(body).slice(0, 500);
    await ingestIncoming({
      channelId: channel.id,
      channelSlug: channel.slug,
      channelType: channel.type,
      externalUserId: String(body.userId || body.from || "unknown"),
      externalChatId: String(body.chatId || body.chat_id || body.userId || "generic"),
      senderName: body.name || body.senderName || "Клиент",
      text,
    });
    return c.json({ ok: true }, 200);
  })

  .post("/telephony/megafon", async (c) => {
    const form = await parseFormOrJson(c);
    const event = parseMegafonBody(form);
    const token = event.crm_token || form.crm_token || "";
    const result = await runTelephonyWebhook(token, async () => {
    const settings = await getTelephonySettings();

    if (isProduction() && !settings.webhookSecret?.trim()) {
      return c.text("Forbidden", 403);
    }
    if (settings.webhookSecret) {
      if (!token || !timingSafeEqualText(token, settings.webhookSecret)) {
        return c.text("Forbidden", 403);
      }
    }

    const phone = event.phone;
    if (!phone) return c.text("OK", 200);

    const client = await findClientByPhone(phone);
    const operator = event.user ? await findUserByExtension(event.user) : null;

    if (isMegafonIncoming(event.type)) {
      const route = await resolveIncomingCallRoute({
        clientId: client?.id,
        megafonOperatorExt: event.user || null,
        fallbackNumber: settings.mtsRedirectNumber,
      });
      const notifyUserId = operator?.id ?? (settings.callLoadBalanceEnabled ? route.userId : null);

      const call = await upsertCallLog({
        phone,
        direction: "inbound",
        provider: "megafon",
        externalId: event.callid || null,
        clientId: client?.id ?? null,
        userId: notifyUserId ?? route.userId,
        operatorExt: event.user || route.extension,
        status: "ringing",
      });
      const auto = await maybeCreateAutoDealFromCall({
        phone,
        clientId: client?.id ?? null,
        clientName: client?.name,
        assignedUserId: notifyUserId ?? route.userId,
        callId: call.id,
      });
      if (auto.clientId && !client?.id) {
        await upsertCallLog({
          phone,
          direction: "inbound",
          provider: "megafon",
          externalId: event.callid || null,
          clientId: auto.clientId,
          userId: notifyUserId ?? route.userId,
          operatorExt: event.user || route.extension,
          status: "ringing",
        });
      }
      await notifyIncomingCall({
        phone,
        clientId: auto.clientId || client?.id,
        clientName: client?.name,
        assignedUserId: notifyUserId,
        callId: call.id,
      });
      return c.text("OK", 200);
    }

    if (isMegafonCompleted(event.type) || isMegafonMissed(event.type)) {
      await upsertCallLog({
        phone,
        direction: "inbound",
        provider: "megafon",
        externalId: event.callid || null,
        clientId: client?.id ?? null,
        userId: operator?.id ?? null,
        operatorExt: event.user || null,
        status: isMegafonMissed(event.type) ? "missed" : "completed",
        durationSec: event.duration ? parseInt(event.duration) : null,
        recordingUrl: event.link || null,
      });
    }

    return c.text("OK", 200);
    });
    return result;
  })

  .post("/telephony/mts", async (c) => {
    const settings = await getTelephonySettings();
    let body: MtsIncomingRequest & Record<string, unknown>;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "bad request" }, 400);
    }

    if (settings.webhookSecret) {
      const token = c.req.header("x-webhook-secret")
        || String(body.token || body.secret || "");
      if (!token || !timingSafeEqualText(token, settings.webhookSecret)) {
        return c.json({ error: "Forbidden" }, 403);
      }
    } else if (isProduction()) {
      return c.json({ error: "Forbidden" }, 403);
    }

    if (body.method === "getControlCallFollowMe") {
      const caller = parseMtsCaller(body);
      if (!caller) {
        return c.json(buildMtsFollowMeResponse(settings.mtsRedirectNumber || ""), 200);
      }

      const client = await findClientByPhone(caller);
      const route = await resolveIncomingCallRoute({
        clientId: client?.id,
        fallbackNumber: settings.mtsRedirectNumber,
      });
      const redirect = route.extension || settings.mtsRedirectNumber || "";

      const call = await upsertCallLog({
        phone: caller,
        direction: "inbound",
        provider: "mts",
        externalId: body.params?.client_id || body.params?.callId || null,
        clientId: client?.id ?? null,
        userId: route.userId,
        operatorExt: route.extension,
        status: "ringing",
      });

      const auto = await maybeCreateAutoDealFromCall({
        phone: caller,
        clientId: client?.id ?? null,
        clientName: client?.name,
        assignedUserId: route.userId,
        callId: call.id,
      });
      if (auto.clientId && !client?.id) {
        await upsertCallLog({
          phone: caller,
          direction: "inbound",
          provider: "mts",
          externalId: body.params?.client_id || body.params?.callId || null,
          clientId: auto.clientId,
          userId: route.userId,
          operatorExt: route.extension,
          status: "ringing",
        });
      }

      await notifyIncomingCall({
        phone: caller,
        clientId: auto.clientId || client?.id,
        clientName: client?.name,
        assignedUserId: route.userId,
        callId: call.id,
      });

      return c.json(buildMtsFollowMeResponse(redirect, body.params?.client_id), 200);
    }

    const caller = (body.caller as string) || parseMtsCaller(body);
    if (caller) {
      const client = await findClientByPhone(caller);
      const status = (body.status as string)?.toLowerCase();
      await upsertCallLog({
        phone: caller,
        direction: body.direction === "outbound" ? "outbound" : "inbound",
        provider: "mts",
        externalId: (body.call_id as string) || null,
        clientId: client?.id ?? null,
        status: status === "missed" ? "missed" : "completed",
        durationSec: body.duration ? Number(body.duration) : null,
        recordingUrl: (body.record_url as string) || null,
      });
    }

    return c.json({ ok: true }, 200);
  });
