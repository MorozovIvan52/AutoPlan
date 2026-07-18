import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { pollAvitoChannel, syncAvitoChannelFull } from "../services/avito-poll";
import { parseConfig, stringifyConfig, type ChannelConfig } from "../lib/channel-config";
import { validateChannel, setupChannel } from "../integrations";
import { webhookUrl } from "../lib/config";
import * as max from "../integrations/max";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getChannelInTenant } from "../lib/tenant-guard";
import { canCreateChannel } from "../lib/quota-enforcement";

async function nextSlug(type: string): Promise<string> {
  const existing = await db.select().from(schema.channels)
    .where(and(eq(schema.channels.type, type), forTenant(schema.channels)));
  const used = new Set(existing.map((c) => c.slug));
  let n = existing.length + 1;
  let slug = `${type}_${n}`;
  while (used.has(slug)) {
    n++;
    slug = `${type}_${n}`;
  }
  return slug;
}

function buildConfigFromBody(body: Record<string, unknown>): ChannelConfig {
  const config: ChannelConfig = typeof body.config === "object" && body.config
    ? { ...(body.config as ChannelConfig) }
    : {};
  if (body.botToken) config.botToken = String(body.botToken);
  if (body.clientId) config.clientId = String(body.clientId);
  if (body.clientSecret) config.clientSecret = String(body.clientSecret);
  if (body.userId) config.userId = String(body.userId);
  if (body.phoneNumberId) config.phoneNumberId = String(body.phoneNumberId);
  if (body.whatsappToken) config.whatsappToken = String(body.whatsappToken);
  if (body.whatsappTemplateName) config.whatsappTemplateName = String(body.whatsappTemplateName);
  if (body.whatsappTemplateLang) config.whatsappTemplateLang = String(body.whatsappTemplateLang);
  if (body.verifyToken) config.verifyToken = String(body.verifyToken);
  if (body.appSecret) config.appSecret = String(body.appSecret);
  if (body.vkToken) config.vkToken = String(body.vkToken);
  if (body.maxToken) config.maxToken = String(body.maxToken);
  if (body.confirmationCode) config.confirmationCode = String(body.confirmationCode);
  if (body.webhookSecret) config.webhookSecret = String(body.webhookSecret);
  return config;
}

function channelPublicWebhookUrl(channel: typeof schema.channels.$inferSelect): string {
  if (channel.type === "telegram") return webhookUrl("telegram", channel.id);
  return webhookUrl(channel.type, channel.slug);
}

function channelSetupHint(type: string): string | undefined {
  switch (type) {
    case "telegram":
      return "Webhook регистрируется автоматически при создании канала. Укажите secret_token для продакшена.";
    case "whatsapp":
      return "В Meta Developer → WhatsApp → Configuration укажите Callback URL и Verify Token. Нужен App Secret для подписи.";
    case "max":
      return "Бот на business.max.ru → токен в настройках. Webhook подписка создаётся автоматически (POST /subscriptions).";
    case "vk":
      return "ВК → Управление сообществом → Callback API: URL, Secret, код подтверждения.";
    default:
      return undefined;
  }
}

function sanitizeChannelForClient(
  channel: typeof schema.channels.$inferSelect,
  includeSecrets: boolean,
) {
  const base = includeSecrets ? channel : {
    id: channel.id,
    name: channel.name,
    slug: channel.slug,
    type: channel.type,
    isActive: channel.isActive,
    lastSyncAt: channel.lastSyncAt,
    createdAt: channel.createdAt,
    config: (() => {
      const config = parseConfig(channel.config);
      return {
        botUsername: config.botUsername,
        phoneNumberId: config.phoneNumberId,
        whatsappTemplateName: config.whatsappTemplateName,
        whatsappTemplateLang: config.whatsappTemplateLang,
      };
    })(),
  };
  return {
    ...base,
    webhookUrl: channelPublicWebhookUrl(channel),
    setupHint: channelSetupHint(channel.type),
  };
}

export const channels = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const includeSecrets = user?.role === "admin";
    const all = await db.select().from(schema.channels).where(forTenant(schema.channels));
    return c.json({ channels: all.map((ch) => sanitizeChannelForClient(ch, includeSecrets)) }, 200);
  })
  .post("/", requireAdmin, async (c) => {
    const body = await c.req.json();
    const type = body.type as string;
    if (!body.name?.trim()) return c.json({ error: "Укажите название канала" }, 400);

    const channelQuota = await canCreateChannel(tenantId());
    if (!channelQuota.allowed) {
      return c.json({ error: channelQuota.reason || "Лимит каналов по тарифу превышен" }, 403);
    }

    const config = buildConfigFromBody(body);
    const validation = await validateChannel(type, config);
    if (!validation.ok) return c.json({ error: validation.error }, 400);

    const finalConfig = { ...config, ...(validation.config || {}) };
    if (validation.botUsername) finalConfig.botUsername = validation.botUsername;

    const slug = body.slug || await nextSlug(type);
    const [channel] = await db.insert(schema.channels).values({
      name: body.name.trim(),
      type,
      slug,
      config: stringifyConfig(finalConfig),
      isActive: body.isActive !== false,
      tenantId: tenantId(),
    }).returning();

    try {
      const setup = await setupChannel(type, channel.id, channel.slug, finalConfig);
      return c.json({ channel: sanitizeChannelForClient(channel, false), webhookUrl: setup.webhookUrl || channelPublicWebhookUrl(channel) }, 201);
    } catch {
      return c.json({ channel: sanitizeChannelForClient(channel, false) }, 201);
    }
  })
  .patch("/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const current = await getChannelInTenant(id);
    if (!current) return c.json({ error: "Канал не найден" }, 404);

    const mergedConfig = { ...parseConfig(current.config), ...buildConfigFromBody(body) };
    const update: Record<string, unknown> = {};
    if (body.name != null) update.name = body.name;
    if (body.isActive != null) update.isActive = body.isActive;
    if (Object.keys(mergedConfig).length) update.config = stringifyConfig(mergedConfig);

    const [channel] = await db.update(schema.channels).set(update)
      .where(withTenant(schema.channels, eq(schema.channels.id, id)))
      .returning();
    return c.json({ channel: sanitizeChannelForClient(channel, false) }, 200);
  })
  .delete("/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    await db.delete(schema.channels).where(withTenant(schema.channels, eq(schema.channels.id, id)));
    return c.json({ ok: true }, 200);
  })
  .post("/:id/sync", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    const channel = await getChannelInTenant(id);
    if (!channel) return c.json({ error: "Канал не найден" }, 404);
    if (channel.type !== "avito") return c.json({ error: "Синхронизация только для Авито" }, 400);

    const full = c.req.query("full") === "1" || c.req.query("full") === "true";
    const result = full
      ? await syncAvitoChannelFull(channel)
      : await pollAvitoChannel(channel);

    return c.json({ ok: true, ...result }, 200);
  })
  .post("/:id/test", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    const channel = await getChannelInTenant(id);
    if (!channel) return c.json({ error: "Канал не найден" }, 404);

    const config = parseConfig(channel.config);

    if (channel.type === "telegram") {
      const v = await validateChannel("telegram", config);
      if (!v.ok) return c.json({ ok: false, error: v.error }, 200);
      const infoRes = await fetch(`https://api.telegram.org/bot${config.botToken}/getWebhookInfo`);
      const info = await infoRes.json() as any;
      const expected = channelPublicWebhookUrl(channel);
      const actual = info.result?.url || "";
      return c.json({
        ok: true,
        botUsername: v.botUsername,
        webhookUrl: actual || expected,
        webhookOk: actual === expected,
        message: actual === expected ? "Telegram OK" : `Webhook: ${actual || "не задан"} (ожидается ${expected})`,
      }, 200);
    }

    if (channel.type === "whatsapp") {
      if (!config.whatsappToken || !config.phoneNumberId) {
        return c.json({ ok: false, error: "Нет токена или Phone Number ID" }, 200);
      }
      const res = await fetch(`https://graph.facebook.com/v18.0/${config.phoneNumberId}?fields=display_phone_number,verified_name`, {
        headers: { Authorization: `Bearer ${config.whatsappToken}` },
      });
      const data = await res.json() as any;
      if (data.error) return c.json({ ok: false, error: data.error.message }, 200);
      return c.json({
        ok: true,
        message: `WhatsApp: ${data.verified_name || "?"} (${data.display_phone_number || config.phoneNumberId})`,
        webhookUrl: channelPublicWebhookUrl(channel),
      }, 200);
    }

    if (channel.type === "max") {
      const v = await max.testMaxChannel(config);
      if (!v.ok) return c.json({ ok: false, error: v.error }, 200);
      return c.json({
        ok: true,
        botUsername: v.botUsername,
        webhookUrl: channelPublicWebhookUrl(channel),
        message: `MAX OK @${v.botUsername || "bot"}`,
      }, 200);
    }

    if (channel.type === "avito") {
      const v = await validateChannel("avito", config);
      return c.json({ ok: v.ok, error: v.error, webhookUrl: channelPublicWebhookUrl(channel) }, 200);
    }

    if (channel.type === "vk") {
      const token = config.vkToken || config.accessToken;
      if (!token) return c.json({ ok: false, error: "Нет токена VK" }, 200);
      return c.json({
        ok: true,
        webhookUrl: channelPublicWebhookUrl(channel),
        message: "Токен задан. Проверьте Callback API в настройках сообщества.",
      }, 200);
    }

    return c.json({ ok: true, message: "Проверка для этого типа не требуется" }, 200);
  });
