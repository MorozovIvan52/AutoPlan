import type { ChannelConfig } from "../lib/channel-config";
import { getPublicUrl } from "../lib/config";
import { normalizePhone } from "../lib/phone";

/** Meta WhatsApp Cloud API */
export async function sendWhatsAppMessage(
  config: ChannelConfig,
  phone: string,
  text: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  if (!config.whatsappToken || !config.phoneNumberId) {
    return { ok: false, error: "Укажите WhatsApp Token и Phone Number ID" };
  }
  const to = normalizePhone(phone);
  if (to.length < 10) return { ok: false, error: "Некорректный номер телефона для WhatsApp" };

  const res = await fetch(`https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
  const data = await res.json() as any;
  if (data.error) return { ok: false, error: data.error.message };
  return { ok: true, externalMessageId: data.messages?.[0]?.id };
}

export async function sendWhatsAppTemplate(
  config: ChannelConfig,
  phone: string,
  templateName: string,
  lang = "ru",
  bodyParams?: string[],
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  if (!config.whatsappToken || !config.phoneNumberId) {
    return { ok: false, error: "Укажите WhatsApp Token и Phone Number ID" };
  }
  const to = normalizePhone(phone);
  if (to.length < 10) return { ok: false, error: "Некорректный номер телефона для WhatsApp" };

  const template: Record<string, unknown> = {
    name: templateName,
    language: { code: lang },
  };
  if (bodyParams?.length) {
    template.components = [{
      type: "body",
      parameters: bodyParams.map((text) => ({ type: "text", text: text.slice(0, 1024) })),
    }];
  }

  const res = await fetch(`https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template,
    }),
  });
  const data = await res.json() as any;
  if (data.error) return { ok: false, error: data.error.message };
  return { ok: true, externalMessageId: data.messages?.[0]?.id };
}

export async function sendWhatsAppMedia(
  config: ChannelConfig,
  phone: string,
  mediaUrl: string,
  mediaType: "photo" | "video" | "document",
  filename?: string,
  caption?: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  if (!config.whatsappToken || !config.phoneNumberId) {
    return { ok: false, error: "Укажите WhatsApp Token и Phone Number ID" };
  }

  const publicBase = getPublicUrl();
  if (!publicBase.startsWith("https://")) {
    return { ok: false, error: "WhatsApp требует HTTPS (укажите PUBLIC_URL в .env)" };
  }

  const link = mediaUrl.startsWith("http") ? mediaUrl : `${publicBase}${mediaUrl}`;
  const to = normalizePhone(phone);

  let mediaBody: Record<string, unknown>;
  if (mediaType === "photo") {
    mediaBody = { type: "image", image: { link, ...(caption?.trim() ? { caption: caption.trim() } : {}) } };
  } else if (mediaType === "video") {
    mediaBody = { type: "video", video: { link, ...(caption?.trim() ? { caption: caption.trim() } : {}) } };
  } else {
    mediaBody = {
      type: "document",
      document: { link, filename: filename || "file", ...(caption?.trim() ? { caption: caption.trim() } : {}) },
    };
  }

  const res = await fetch(`https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.whatsappToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ messaging_product: "whatsapp", to, ...mediaBody }),
  });
  const data = await res.json() as any;
  if (data.error) return { ok: false, error: data.error.message };
  return { ok: true, externalMessageId: data.messages?.[0]?.id };
}

export function parseWhatsAppStatus(body: any) {
  const change = body?.entry?.[0]?.changes?.[0];
  const status = change?.value?.statuses?.[0];
  if (!status?.id || !status?.status) return null;
  return {
    externalMessageId: String(status.id),
    status: String(status.status),
  };
}

export function parseWhatsAppWebhook(body: any) {
  const entry = body?.entry?.[0];
  const change = entry?.changes?.[0];
  const msg = change?.value?.messages?.[0];
  if (!msg) return null;
  const contact = change?.value?.contacts?.[0];
  const type = msg.type;
  let text = msg.text?.body || "";
  let mediaType: string | undefined;
  let mediaUrl: string | undefined;
  if (type === "image") {
    text = msg.image?.caption || "[фото]";
    mediaType = "photo";
    if (msg.image?.id) mediaUrl = `whatsapp:${msg.image.id}`;
  } else if (type === "video") {
    text = msg.video?.caption || "[видео]";
    mediaType = "video";
    if (msg.video?.id) mediaUrl = `whatsapp:${msg.video.id}`;
  } else if (type === "document") {
    text = msg.document?.caption || msg.document?.filename || "[файл]";
    mediaType = "document";
    if (msg.document?.id) mediaUrl = `whatsapp:${msg.document.id}`;
  } else if (type === "audio") {
    text = "[аудио]";
    mediaType = "document";
    if (msg.audio?.id) mediaUrl = `whatsapp:${msg.audio.id}`;
  } else if (type !== "text") return null;

  return {
    externalUserId: msg.from,
    externalChatId: msg.from,
    senderName: contact?.profile?.name || msg.from,
    text,
    externalMessageId: msg.id,
    mediaUrl,
    mediaType,
  };
}
