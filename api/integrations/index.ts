import type { ChannelConfig } from "../lib/channel-config";
import * as telegram from "./telegram";
import * as avito from "./avito";
import * as whatsapp from "./whatsapp";
import * as vk from "./vk";
import * as max from "./max";
import { webhookUrl } from "../lib/config";
import { resolveUploadPath } from "../lib/uploads";
import { prepareAvitoImageUpload } from "../lib/avito-outgoing-media";

export type OutgoingMedia = {
  mediaUrl: string;
  mediaType: "photo" | "video" | "document";
};

export type ValidateResult = {
  ok: boolean;
  error?: string;
  config?: ChannelConfig;
  botUsername?: string;
};

export async function validateChannel(type: string, config: ChannelConfig): Promise<ValidateResult> {
  switch (type) {
    case "telegram":
      return telegram.validateTelegram(config);
    case "avito":
      return avito.validateAvito(config);
    case "whatsapp":
      return config.whatsappToken && config.phoneNumberId
        ? { ok: true }
        : { ok: false, error: "Token и Phone Number ID обязательны" };
    case "vk":
      return config.vkToken || config.accessToken
        ? { ok: true }
        : { ok: false, error: "Токен VK обязателен" };
    case "max":
      return max.validateMax(config);
    default:
      return { ok: true };
  }
}

export type SetupChannelResult = {
  ok: boolean;
  error?: string;
  webhookUrl?: string;
};

export async function setupChannel(
  type: string,
  channelId: number,
  slug: string,
  config: ChannelConfig,
): Promise<SetupChannelResult> {
  if (type === "telegram" && config.botToken) {
    const result = await telegram.setupTelegramWebhook(channelId, config);
    return { ...result, webhookUrl: webhookUrl("telegram", channelId) };
  }
  if (type === "avito") {
    const url = webhookUrl("avito", slug);
    const result = await avito.setupAvitoWebhook(config, url);
    return { ...result, webhookUrl: url };
  }
  if (type === "max" && (config.maxToken || config.botToken)) {
    return max.setupMaxWebhook(slug, config);
  }
  return { ok: true, webhookUrl: webhookUrl(type, type === "telegram" ? channelId : slug) };
}

export async function sendChannelMessage(
  type: string,
  config: ChannelConfig,
  externalChatId: string,
  text: string,
  clientPhone?: string | null,
  media?: OutgoingMedia,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string; config?: ChannelConfig }> {
  if (media) {
    const file = resolveUploadPath(media.mediaUrl);
    if (!file) return { ok: false, error: "Файл не найден на сервере" };
    const mediaType = file.mediaType;

    if (type === "avito") {
      const prepared = await prepareAvitoImageUpload(file.buffer, file.mime, file.filename, mediaType);
      const upload = await avito.uploadAvitoImage(config, prepared.buffer, prepared.filename, prepared.mime);
      if (!upload.ok || !upload.imageId) {
        return { ok: false, error: upload.error || "Не удалось загрузить файл в Авито", config: upload.config };
      }
      let updatedConfig = upload.config || config;
      const sent = await avito.sendAvitoImage(updatedConfig, externalChatId, upload.imageId);
      if (sent.config) updatedConfig = sent.config;
      if (!sent.ok) return { ok: false, error: sent.error, config: updatedConfig };
      if (text.trim()) {
        const textRes = await avito.sendAvitoMessage(updatedConfig, externalChatId, text.trim());
        return { ...textRes, config: textRes.config || updatedConfig };
      }
      return sent;
    }

    if (type === "telegram") {
      return telegram.sendTelegramMedia(config, externalChatId, file, mediaType, text);
    }

    if (type === "whatsapp") {
      return whatsapp.sendWhatsAppMedia(
        config,
        clientPhone || externalChatId,
        media.mediaUrl,
        mediaType,
        file.filename,
        text,
      );
    }

    return { ok: false, error: `Отправка файлов для канала ${type} не настроена` };
  }

  switch (type) {
    case "telegram":
      return telegram.sendTelegramMessage(config, externalChatId, text);
    case "avito":
      return avito.sendAvitoMessage(config, externalChatId, text);
    case "whatsapp":
      return whatsapp.sendWhatsAppMessage(config, clientPhone || externalChatId, text);
    case "vk":
      return vk.sendVkMessage(config, externalChatId, text);
    case "max":
      return max.sendMaxMessage(config, externalChatId, text);
    case "manual":
    case "email":
    case "instagram":
      return { ok: true };
    default:
      return { ok: false, error: `Отправка для ${type} не настроена` };
  }
}

export function parseWebhook(type: string, body: any) {
  switch (type) {
    case "telegram":
      return telegram.parseTelegramUpdate(body);
    case "avito":
      return avito.parseAvitoWebhook(body);
    case "whatsapp":
      return whatsapp.parseWhatsAppWebhook(body);
    case "vk":
      return vk.parseVkWebhook(body);
    case "max":
      return max.parseMaxWebhook(body);
    default:
      return null;
  }
}
