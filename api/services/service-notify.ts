import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, desc } from "drizzle-orm";
import { parseConfig } from "../lib/channel-config";
import { sendWhatsAppMessage, sendWhatsAppTemplate } from "../integrations/whatsapp";
import { normalizePhone, whatsappRecipient, isWhatsAppSessionError } from "../lib/phone";
import { broadcast } from "./ws";

function isWhatsAppChannel(type: string, slug: string): boolean {
  return type === "whatsapp" || slug.startsWith("whatsapp");
}

export async function findWhatsAppConversation(clientId: number) {
  const convs = await db.select().from(schema.conversations).where(eq(schema.conversations.clientId, clientId));
  for (const conv of convs) {
    if (isWhatsAppChannel("", conv.channelType || "")) {
      const [ch] = conv.channelId
        ? await db.select().from(schema.channels).where(eq(schema.channels.id, conv.channelId))
        : conv.channelType
          ? await db.select().from(schema.channels).where(eq(schema.channels.slug, conv.channelType)).limit(1)
          : [];
      if (ch) return { conv, channel: ch };
    }
    if (!conv.channelId) continue;
    const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, conv.channelId));
    if (ch && isWhatsAppChannel(ch.type, ch.slug)) return { conv, channel: ch };
  }

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client?.phone) return null;

  const channels = await db.select().from(schema.channels).where(
    and(eq(schema.channels.type, "whatsapp"), eq(schema.channels.isActive, true)),
  );
  const channel = channels.find((c) => {
    const cfg = parseConfig(c.config);
    return cfg.whatsappToken && cfg.phoneNumberId;
  }) || channels[0];
  if (!channel) return null;

  const phone = normalizePhone(client.phone);
  const [conv] = await db.insert(schema.conversations).values({
    clientId,
    channelId: channel.id,
    channelType: channel.slug,
    externalChatId: phone,
    status: "open",
    lastMessageAt: new Date(),
  }).returning();

  return { conv, channel };
}

async function findOrCreateClientByPhone(phone: string) {
  const normalized = normalizePhone(phone);
  const all = await db.select().from(schema.clients);
  const found = all.find((c) => c.phone && normalizePhone(c.phone) === normalized);
  if (found) return found;

  const [created] = await db.insert(schema.clients).values({
    name: phone.trim(),
    phone: phone.trim(),
    source: "repair_booking",
  }).returning();
  return created;
}

async function saveOperatorWhatsAppMessage(
  conversationId: number,
  text: string,
  senderId?: number,
  externalMessageId?: string,
) {
  const [msg] = await db.insert(schema.messages).values({
    conversationId,
    senderType: "operator",
    senderId,
    text,
    externalMessageId,
  }).returning();
  await db.update(schema.conversations).set({
    lastMessageAt: new Date(),
    unreadCount: 0,
    unreadPinned: false,
  }).where(eq(schema.conversations.id, conversationId));
  broadcast({ type: "message_sent", conversationId, message: msg });
  return msg;
}

export async function sendWhatsAppToPhone(
  phone: string,
  text: string,
  senderId?: number,
): Promise<{ ok: boolean; conversationId?: number; error?: string }> {
  const client = await findOrCreateClientByPhone(phone);
  return sendWhatsAppToClient(client.id, text, senderId);
}

export async function sendWhatsAppToClient(
  clientId: number,
  text: string,
  senderId?: number,
): Promise<{ ok: boolean; conversationId?: number; error?: string; usedTemplate?: boolean }> {
  const found = await findWhatsAppConversation(clientId);
  if (!found) {
    return { ok: false, error: "WhatsApp не настроен. Настройки → Каналы: Token, Phone Number ID и шаблон для рассылок." };
  }

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  const config = parseConfig(found.channel.config);
  if (!config.whatsappToken || !config.phoneNumberId) {
    return { ok: false, error: "В канале WhatsApp не указаны Token и Phone Number ID" };
  }

  const recipient = whatsappRecipient(client?.phone || "", found.conv.externalChatId);
  if (recipient.length < 10) {
    return { ok: false, error: "У клиента нет корректного номера телефона" };
  }

  let waResult = await sendWhatsAppMessage(config, recipient, text);
  let usedTemplate = false;

  if (!waResult.ok && isWhatsAppSessionError(waResult.error)) {
    const tplName = config.whatsappTemplateName || process.env.WHATSAPP_BROADCAST_TEMPLATE;
    const tplLang = config.whatsappTemplateLang || process.env.WHATSAPP_BROADCAST_TEMPLATE_LANG || "ru";
    if (tplName) {
      waResult = await sendWhatsAppTemplate(config, recipient, tplName, tplLang, [text]);
      usedTemplate = true;
    } else {
      return {
        ok: false,
        error: `${waResult.error}. Для рассылки укажите одобренный шаблон Meta в Настройках → Каналы → WhatsApp (поле «Шаблон рассылки»).`,
      };
    }
  }

  if (!waResult.ok) {
    const recent = await db.select().from(schema.messages)
      .where(eq(schema.messages.conversationId, found.conv.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(3);
    const dup = recent.find((m) =>
      m.senderType === "operator" && m.text === text
      && m.createdAt && m.createdAt.getTime() > Date.now() - 60_000,
    );
    if (dup) return { ok: true, conversationId: found.conv.id };
    return { ok: false, error: waResult.error || "Не удалось отправить WhatsApp" };
  }

  await saveOperatorWhatsAppMessage(found.conv.id, text, senderId, waResult.externalMessageId);
  return { ok: true, conversationId: found.conv.id, usedTemplate };
}

export async function broadcastScheduleWhatsApp(
  text: string,
  senderId?: number,
): Promise<{ sent: number; failed: number; errors: string[] }> {
  const channels = await db.select().from(schema.channels).where(eq(schema.channels.type, "whatsapp"));
  if (!channels.length) {
    return { sent: 0, failed: 0, errors: ["Канал WhatsApp не настроен"] };
  }

  const channelIds = new Set(channels.map((c) => c.id));
  const convs = await db.select().from(schema.conversations);
  const clientIds = [...new Set(
    convs
      .filter((c) => c.channelId && channelIds.has(c.channelId))
      .map((c) => c.clientId),
  )];

  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const clientId of clientIds) {
    const r = await sendWhatsAppToClient(clientId, text, senderId);
    if (r.ok) sent++;
    else {
      failed++;
      if (r.error && !errors.includes(r.error)) errors.push(r.error);
    }
  }

  return { sent, failed, errors };
}
