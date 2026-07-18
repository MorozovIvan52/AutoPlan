import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { parseConfig, stringifyConfig, type ChannelConfig } from "../lib/channel-config";
import { validateChannel, setupChannel } from "../integrations";
import { getPublicUrl } from "../lib/config";

type AvitoEnvSlot = {
  slot: number;
  name: string;
  clientId?: string;
  clientSecret?: string;
  userId?: string;
  webhookSecret?: string;
};

function avitoEnvKey(slot: number, field: string): string {
  if (slot === 1) return `AVITO_${field}`;
  return `AVITO_${slot}_${field}`;
}

function avitoSlotsFromEnv(): AvitoEnvSlot[] {
  const defaultNames: Record<number, string> = {
    1: "Авито — основной",
    2: "Авито — ремонт АВД",
    3: "шлицыРФ",
  };
  const slots: AvitoEnvSlot[] = [];

  for (let slot = 1; slot <= 5; slot++) {
    const clientId = process.env[avitoEnvKey(slot, "CLIENT_ID")];
    const clientSecret = process.env[avitoEnvKey(slot, "CLIENT_SECRET")];
    const userId = process.env[avitoEnvKey(slot, "USER_ID")];
    if (!clientId || !clientSecret || !userId) continue;

    slots.push({
      slot,
      name: process.env[avitoEnvKey(slot, "NAME")] || defaultNames[slot] || `Авито ${slot}`,
      clientId,
      clientSecret,
      userId,
      webhookSecret: process.env[avitoEnvKey(slot, "WEBHOOK_SECRET")],
    });
  }

  return slots;
}

async function ensureAvitoChannel(slot: AvitoEnvSlot) {
  const slug = `avito_${slot.slot}`;
  const config = {
    clientId: slot.clientId!,
    clientSecret: slot.clientSecret!,
    userId: String(slot.userId),
    webhookSecret: slot.webhookSecret,
  };
  const validation = await validateChannel("avito", config);
  if (!validation.ok) return { slug, error: validation.error };

  const finalConfig = validation.config || config;
  const all = await db.select().from(schema.channels).where(eq(schema.channels.type, "avito"));
  const existing = all.find((ch) => ch.slug === slug);

  if (!existing) {
    const [ch] = await db.insert(schema.channels).values({
      name: slot.name,
      slug,
      type: "avito",
      config: stringifyConfig(finalConfig),
    }).returning();
    return { slug, id: ch.id, created: true };
  }

  const cfg = { ...parseConfig(existing.config), ...finalConfig };
  await db.update(schema.channels).set({
    name: slot.name,
    config: stringifyConfig(cfg),
  }).where(eq(schema.channels.id, existing.id));
  return { slug, id: existing.id, updated: true };
}

export async function bootstrapChannelsFromEnv() {
  const results: string[] = [];

  const avitoSlots = avitoSlotsFromEnv();
  if (avitoSlots.length > 0) {
    for (const slot of avitoSlots) {
      try {
        const r = await ensureAvitoChannel(slot);
        if (r.error) results.push(`${slot.name}: ошибка — ${r.error}`);
        else if (r.created) results.push(`${slot.name} создан (id=${r.id}, slug=${r.slug})`);
        else if (r.updated) results.push(`${slot.name} обновлён (id=${r.id})`);
      } catch (e: any) {
        results.push(`${slot.name}: ${e.message}`);
      }
    }

    const publicUrl = getPublicUrl();
    const isLocal = publicUrl.includes("localhost") || publicUrl.includes("127.0.0.1");
    const avitoChannels = await db.select().from(schema.channels).where(eq(schema.channels.type, "avito"));

    if (!isLocal && publicUrl.startsWith("https://")) {
      for (const ch of avitoChannels) {
        const cfg = parseConfig(ch.config);
        const setup = await setupChannel("avito", ch.id, ch.slug, cfg);
        if (setup.ok) results.push(`${ch.name}: webhook ${setup.webhookUrl}`);
        else results.push(`${ch.name}: webhook — ${(setup as any).error || "ошибка"}`);
      }
    } else if (avitoChannels.length > 0 && isLocal) {
      const pollSec = process.env.AVITO_POLL_INTERVAL_SECONDS || "8";
      results.push(`Авито (${avitoChannels.length} акк.): polling каждые ${pollSec}с`);
    }
  }

  const tgToken = process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
  if (tgToken) {
    const existing = await db.select().from(schema.channels).where(eq(schema.channels.type, "telegram"));
    if (existing.length === 0) {
      const config = { botToken: tgToken };
      const validation = await validateChannel("telegram", config);
      if (validation.ok) {
        const finalConfig = { ...config, botUsername: validation.botUsername };
        const [ch] = await db.insert(schema.channels).values({
          name: "Telegram Bot",
          slug: "telegram_1",
          type: "telegram",
          config: stringifyConfig(finalConfig),
        }).returning();
        const publicUrl = getPublicUrl();
        if (!publicUrl.includes("localhost") && !publicUrl.includes("127.0.0.1")) {
          await setupChannel("telegram", ch.id, ch.slug, finalConfig);
          results.push(`Telegram канал + webhook (id=${ch.id})`);
        } else {
          results.push(`Telegram канал создан (id=${ch.id}), polling включён — localhost без webhook`);
        }
      } else {
        results.push(`Telegram: ${validation.error}`);
      }
    } else {
      const ch = existing[0];
      const cfg = { ...parseConfig(ch.config), botToken: tgToken };
      await db.update(schema.channels).set({ config: stringifyConfig(cfg) }).where(eq(schema.channels.id, ch.id));
      results.push(`Telegram токен обновлён (id=${ch.id})`);
    }
  }

  const waToken = process.env.WHATSAPP_TOKEN || process.env.WHATSAPP_ACCESS_TOKEN;
  const waPhoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const waTemplate = process.env.WHATSAPP_BROADCAST_TEMPLATE;
  if (waToken && waPhoneId) {
    const existing = await db.select().from(schema.channels).where(eq(schema.channels.type, "whatsapp"));
    const config = {
      whatsappToken: waToken,
      phoneNumberId: waPhoneId,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
      whatsappTemplateName: waTemplate,
      whatsappTemplateLang: process.env.WHATSAPP_BROADCAST_TEMPLATE_LANG || "ru",
    };
    if (existing.length === 0) {
      const [ch] = await db.insert(schema.channels).values({
        name: "WhatsApp",
        slug: "whatsapp_1",
        type: "whatsapp",
        config: stringifyConfig(config),
      }).returning();
      results.push(`WhatsApp канал создан (id=${ch.id})`);
    } else {
      const ch = existing[0];
      const merged = { ...parseConfig(ch.config), ...config };
      await db.update(schema.channels).set({ config: stringifyConfig(merged) }).where(eq(schema.channels.id, ch.id));
      results.push(`WhatsApp канал обновлён (id=${ch.id})`);
    }
  }

  const maxToken = process.env.MAX_BOT_TOKEN;
  if (maxToken) {
    const existing = await db.select().from(schema.channels).where(eq(schema.channels.type, "max"));
    const config: ChannelConfig = {
      maxToken,
      webhookSecret: process.env.MAX_WEBHOOK_SECRET,
    };
    const validation = await validateChannel("max", config);
    if (!validation.ok) {
      results.push(`MAX: ${validation.error}`);
    } else if (existing.length === 0) {
      const finalConfig = { ...config, botUsername: validation.botUsername };
      const [ch] = await db.insert(schema.channels).values({
        name: process.env.MAX_BOT_NAME || "MAX Bot",
        slug: "max_1",
        type: "max",
        config: stringifyConfig(finalConfig),
      }).returning();
      const publicUrl = getPublicUrl();
      if (!publicUrl.includes("localhost") && publicUrl.startsWith("https://")) {
        const setup = await setupChannel("max", ch.id, ch.slug, finalConfig);
        results.push(setup.ok ? `MAX канал + webhook (id=${ch.id})` : `MAX канал (id=${ch.id}), webhook — ${(setup as any).error}`);
      } else {
        results.push(`MAX канал создан (id=${ch.id})`);
      }
    } else {
      const ch = existing[0];
      const merged = { ...parseConfig(ch.config), ...config, botUsername: validation.botUsername };
      await db.update(schema.channels).set({ config: stringifyConfig(merged) }).where(eq(schema.channels.id, ch.id));
      const publicUrl = getPublicUrl();
      if (!publicUrl.includes("localhost") && publicUrl.startsWith("https://")) {
        const setup = await setupChannel("max", ch.id, ch.slug, merged);
        results.push(setup.ok ? `MAX обновлён + webhook (id=${ch.id})` : `MAX обновлён (id=${ch.id}), webhook — ${(setup as any).error}`);
      } else {
        results.push(`MAX токен обновлён (id=${ch.id})`);
      }
    }
  }

  return results;
}
