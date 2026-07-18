import type { ChannelConfig } from "../lib/channel-config";
import { webhookUrl } from "../lib/config";

export async function validateTelegram(config: ChannelConfig): Promise<{ ok: boolean; error?: string; botUsername?: string }> {
  if (!config.botToken) return { ok: false, error: "Укажите Bot Token" };
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/getMe`);
  const data = await res.json() as any;
  if (!data.ok) return { ok: false, error: data.description || "Неверный токен" };
  return { ok: true, botUsername: data.result?.username };
}

export async function setupTelegramWebhook(channelId: number, config: ChannelConfig): Promise<{ ok: boolean; error?: string }> {
  const url = webhookUrl("telegram", channelId);
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      allowed_updates: ["message", "edited_message"],
      ...(config.webhookSecret?.trim() ? { secret_token: config.webhookSecret.trim() } : {}),
    }),
  });
  const data = await res.json() as any;
  if (!data.ok) return { ok: false, error: data.description };
  return { ok: true };
}

export async function sendTelegramMessage(
  config: ChannelConfig,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json() as any;
  if (!data.ok) return { ok: false, error: data.description };
  return { ok: true, externalMessageId: String(data.result?.message_id) };
}

export async function sendTelegramMedia(
  config: ChannelConfig,
  chatId: string,
  file: { buffer: Buffer; filename: string; mime: string },
  mediaType: "photo" | "video" | "document",
  caption?: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  const method = mediaType === "photo" ? "sendPhoto"
    : mediaType === "video" ? "sendVideo"
    : "sendDocument";
  const field = mediaType === "photo" ? "photo" : mediaType === "video" ? "video" : "document";

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption?.trim()) form.append("caption", caption.trim());
  form.append(field, new Blob([new Uint8Array(file.buffer)], { type: file.mime }), file.filename);

  const res = await fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST",
    body: form,
  });
  const data = await res.json() as any;
  if (!data.ok) return { ok: false, error: data.description || "Ошибка Telegram" };
  return { ok: true, externalMessageId: String(data.result?.message_id) };
}

export function parseTelegramUpdate(body: any) {
  const msg = body?.message || body?.edited_message;
  if (!msg) return null;
  const fromUser = msg.from;
  return {
    externalUserId: String(fromUser.id),
    externalChatId: String(msg.chat.id),
    senderName: [fromUser.first_name, fromUser.last_name].filter(Boolean).join(" ") || fromUser.username || "Telegram",
    text: msg.text || msg.caption || "[медиа]",
    externalMessageId: String(msg.message_id),
    mediaUrl: msg.photo?.length ? `telegram:${msg.photo[msg.photo.length - 1].file_id}`
      : msg.video?.file_id ? `telegram:${msg.video.file_id}`
      : msg.document?.file_id ? `telegram:${msg.document.file_id}`
      : undefined,
    mediaType: msg.photo ? "photo" : msg.video ? "video" : msg.document ? "document" : undefined,
  };
}
