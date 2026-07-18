import { basename } from "node:path";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { readUpload, saveUpload } from "./uploads";
import type { MediaKind } from "./media";
import {
  cacheTelegramMediaForMessage,
  downloadTelegramFile,
  parseTelegramFileId,
} from "./telegram-media";
import { downloadWhatsAppMedia, parseWhatsAppMediaId } from "./whatsapp-media";
import { cacheHttpMedia, fetchHttpMediaBuffer } from "./remote-media";
import { isAvitoHttpUrl, refreshAvitoImageUrl, parseAvitoVoiceId, downloadAvitoVoice, refreshAvitoVoiceRef } from "./avito-media";
import { extFromMime } from "./media";
import { parseConfig } from "./channel-config";

async function resolveChannelId(conversation: typeof schema.conversations.$inferSelect): Promise<number | null> {
  if (conversation.channelId) return conversation.channelId;
  if (!conversation.channelType) return null;
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.slug, conversation.channelType));
  return channel?.id ?? null;
}

export type ResolvedMedia = {
  buffer: Buffer;
  mime: string;
  filename: string;
};

export async function resolveMessageMedia(
  message: typeof schema.messages.$inferSelect,
  conversation: typeof schema.conversations.$inferSelect,
): Promise<ResolvedMedia | null> {
  let mediaUrl = message.mediaUrl;

  const channelId = await resolveChannelId(conversation);

  if (!mediaUrl && channelId && conversation.externalChatId && message.externalMessageId) {
    const isVoicePlaceholder = message.text === "[голосовое]"
      || message.text?.includes("Голосовое сообщение");
    if (isVoicePlaceholder) {
      mediaUrl = await refreshAvitoVoiceRef(channelId, conversation.externalChatId, message.externalMessageId)
        ?? `avito:voice:${message.externalMessageId}`;
    }
  }

  if (!mediaUrl) return null;

  const voiceId = parseAvitoVoiceId(mediaUrl);
  if (voiceId && channelId) {
    const file = await downloadAvitoVoice(channelId, voiceId);
    if (file) {
      try {
        const saved = saveUpload(file.buffer, file.filename, file.mime);
        await db.update(schema.messages)
          .set({ mediaUrl: saved.url, mediaType: saved.mediaType })
          .where(eq(schema.messages.id, message.id));
        return { buffer: file.buffer, mime: file.mime, filename: file.filename };
      } catch {
        return file;
      }
    }
    return null;
  }

  const fileId = parseTelegramFileId(mediaUrl);
  if (fileId && channelId) {
    const cached = await cacheTelegramMediaForMessage(
      message.id,
      channelId,
      fileId,
      message.mediaType as MediaKind | undefined,
    );
    if (cached) mediaUrl = cached;
    else {
      const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
      const token = channel ? parseConfig(channel.config).botToken : undefined;
      if (!token) return null;
      const file = await downloadTelegramFile(token, fileId, message.mediaType as MediaKind | undefined);
      if (!file) return null;
      return file;
    }
  }

  const waMediaId = parseWhatsAppMediaId(mediaUrl);
  if (waMediaId && channelId) {
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
    const config = channel ? parseConfig(channel.config) : {};
    const file = await downloadWhatsAppMedia(
      config,
      waMediaId,
      message.mediaType as MediaKind | undefined,
      message.text != null && message.text !== "[файл]" && message.text !== "[фото]" && message.text !== "[видео]" ? message.text : undefined,
    );
    if (!file) return null;
    try {
      const saved = saveUpload(file.buffer, file.filename, file.mime);
      await db.update(schema.messages)
        .set({ mediaUrl: saved.url, mediaType: saved.mediaType })
        .where(eq(schema.messages.id, message.id));
      return { buffer: file.buffer, mime: saved.mime, filename: saved.filename };
    } catch {
      return file;
    }
  }

  const uploadMatch = mediaUrl.match(/\/api\/uploads\/([^?#]+)/);
  if (uploadMatch) {
    const data = readUpload(uploadMatch[1]);
    if (!data) return null;
    const filename = mediaDownloadName(message, data.mime);
    return { buffer: data.buffer, mime: data.mime, filename };
  }

  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) {
    let sourceUrl = mediaUrl;
    let cached: Awaited<ReturnType<typeof cacheHttpMedia>> = null;

    if (isAvitoHttpUrl(sourceUrl) && channelId && message.externalMessageId && conversation.externalChatId) {
      const fresh = await refreshAvitoImageUrl(channelId, conversation.externalChatId, message.externalMessageId);
      if (fresh) {
        sourceUrl = fresh;
        cached = await cacheHttpMedia(fresh, message.mediaType as MediaKind | undefined);
      }
    }

    if (!cached) {
      cached = await cacheHttpMedia(sourceUrl, message.mediaType as MediaKind | undefined);
    }

    if (cached) {
      await db.update(schema.messages)
        .set({ mediaUrl: cached.url, mediaType: cached.mediaType })
        .where(eq(schema.messages.id, message.id));
      const data = readUpload(cached.filename);
      if (data) {
        return { buffer: data.buffer, mime: data.mime, filename: mediaDownloadName({ ...message, mediaUrl: cached.url }, data.mime) };
      }
    }

    const direct = await fetchHttpMediaBuffer(sourceUrl, message.mediaType as MediaKind | undefined);
    if (direct) {
      return {
        buffer: direct.buffer,
        mime: direct.mime,
        filename: mediaDownloadName(message, direct.mime),
      };
    }
    return null;
  }

  return null;
}

export function mediaDownloadName(
  message: typeof schema.messages.$inferSelect,
  mime: string,
): string {
  if (message.mediaUrl?.includes("/api/uploads/")) {
    const stored = message.mediaUrl.split("/").pop() || "file";
    if (/\.(jpe?g|png|webp|gif|mp4|pdf|docx?|xlsx?|zip)$/i.test(stored)) return stored;
    if (mime.startsWith("image/")) return `photo-${message.id}${extFromMime(mime)}`;
    if (mime.startsWith("video/")) return `video-${message.id}${extFromMime(mime)}`;
    return stored;
  }
  const ext = mime.includes("jpeg") || mime.includes("jpg") ? ".jpg"
    : mime.includes("png") ? ".png"
    : mime.includes("webp") ? ".webp"
    : mime.includes("mp4") ? ".mp4"
    : mime.includes("pdf") ? ".pdf"
    : mime.includes("octet-stream") ? ".bin"
    : "";
  const base = message.mediaType === "video" ? "video"
    : message.mediaType === "document" ? "document"
    : "photo";
  return `${base}-${message.id}${ext || ".jpg"}`;
}
