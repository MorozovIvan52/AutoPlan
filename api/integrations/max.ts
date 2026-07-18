import type { ChannelConfig } from "../lib/channel-config";
import { webhookUrl } from "../lib/config";

const MAX_API = "https://platform-api2.max.ru";

function authHeaders(token: string): HeadersInit {
  return { Authorization: token };
}

export async function validateMax(config: ChannelConfig): Promise<{ ok: boolean; error?: string; botUsername?: string }> {
  const token = config.maxToken || config.botToken;
  if (!token) return { ok: false, error: "Укажите токен бота MAX" };
  const res = await fetch(`${MAX_API}/me`, { headers: authHeaders(token) });
  if (!res.ok) {
    const err = await res.text().catch(() => "");
    return { ok: false, error: err || `HTTP ${res.status}` };
  }
  const data = await res.json() as { username?: string; first_name?: string; user_id?: number };
  return { ok: true, botUsername: data.username || data.first_name || String(data.user_id || "bot") };
}

export async function setupMaxWebhook(
  slug: string,
  config: ChannelConfig,
): Promise<{ ok: boolean; error?: string; webhookUrl?: string }> {
  const token = config.maxToken || config.botToken;
  if (!token) return { ok: false, error: "Нет токена MAX" };

  const url = webhookUrl("max", slug);
  const secret = config.webhookSecret?.trim();
  const body: Record<string, unknown> = {
    url,
    update_types: ["message_created", "bot_started", "message_callback"],
  };
  if (secret) body.secret = secret;

  const res = await fetch(`${MAX_API}/subscriptions`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({})) as { success?: boolean; message?: string };
  if (!res.ok || data.success === false) {
    return { ok: false, error: data.message || `HTTP ${res.status}` };
  }
  return { ok: true, webhookUrl: url };
}

export async function sendMaxMessage(
  config: ChannelConfig,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  const token = config.maxToken || config.botToken;
  if (!token) return { ok: false, error: "Нет токена MAX" };

  const res = await fetch(`${MAX_API}/messages?chat_id=${encodeURIComponent(chatId)}`, {
    method: "POST",
    headers: { ...authHeaders(token), "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const data = await res.json().catch(() => ({})) as {
    message?: { body?: { mid?: string } };
  };
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}` };
  }
  const mid = (data as { message?: { body?: { mid?: string } } }).message?.body?.mid;
  return { ok: true, externalMessageId: mid };
}

export function parseMaxWebhook(body: any) {
  const updateType = body?.update_type;
  if (!updateType) return null;

  if (updateType === "message_created") {
    const msg = body.message;
    if (!msg?.body) return null;
    if (msg.sender?.is_bot) return null;

    const chatId = msg.recipient?.chat_id ?? msg.chat_id;
    const userId = msg.sender?.user_id;
    if (chatId == null || userId == null) return null;

    let text = msg.body.text || "";
    let mediaType: string | undefined;
    const attachments = msg.body.attachments || msg.attachments;
    if (Array.isArray(attachments) && attachments.length > 0) {
      const att = attachments[0];
      const t = att?.type;
      if (t === "image") { text = text || "[фото]"; mediaType = "photo"; }
      else if (t === "video") { text = text || "[видео]"; mediaType = "video"; }
      else if (t === "file" || t === "audio") { text = text || "[файл]"; mediaType = "document"; }
      else if (t === "contact") { text = text || "[контакт]"; }
      else if (!text) text = `[${t || "вложение"}]`;
    }
    if (!text.trim()) text = "[сообщение]";

    const senderName = msg.sender?.name
      || [msg.sender?.first_name, msg.sender?.last_name].filter(Boolean).join(" ")
      || `MAX ${userId}`;

    return {
      externalUserId: String(userId),
      externalChatId: String(chatId),
      senderName,
      text,
      externalMessageId: String(msg.body.mid || `${updateType}:${body.timestamp}:${userId}`),
      mediaType,
    };
  }

  if (updateType === "bot_started") {
    const user = body.user || body.message?.sender;
    const chatId = body.chat_id ?? body.message?.recipient?.chat_id;
    const userId = user?.user_id ?? body.user_id;
    if (chatId == null || userId == null) return null;

    const senderName = user?.name
      || [user?.first_name, user?.last_name].filter(Boolean).join(" ")
      || `MAX ${userId}`;

    return {
      externalUserId: String(userId),
      externalChatId: String(chatId),
      senderName,
      text: "/start",
      externalMessageId: `bot_started:${body.timestamp}:${userId}`,
    };
  }

  return null;
}

export async function testMaxChannel(config: ChannelConfig): Promise<{ ok: boolean; error?: string; botUsername?: string }> {
  const validation = await validateMax(config);
  if (!validation.ok) return validation;
  return { ok: true, botUsername: validation.botUsername };
}
