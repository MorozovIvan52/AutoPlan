import { extname } from "node:path";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { parseConfig } from "./channel-config";
import { saveUpload, readUpload } from "./uploads";
import { mimeFromExt, type MediaKind } from "./media";

export async function downloadTelegramFile(
  botToken: string,
  fileId: string,
  mediaType?: MediaKind,
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  const infoRes = await fetch(`https://api.telegram.org/bot${botToken}/getFile?file_id=${encodeURIComponent(fileId)}`);
  const info = await infoRes.json() as { ok?: boolean; result?: { file_path?: string } };
  if (!info.ok || !info.result?.file_path) return null;

  const filePath = info.result.file_path;
  const fileRes = await fetch(`https://api.telegram.org/file/bot${botToken}/${filePath}`);
  if (!fileRes.ok) return null;

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const ext = extname(filePath) || (mediaType === "video" ? ".mp4" : mediaType === "document" ? ".bin" : ".jpg");
  const filename = `telegram-${fileId.slice(0, 12)}${ext}`;
  const mime = mimeFromExt(ext);
  return { buffer, filename, mime };
}

export async function cacheTelegramMediaForMessage(
  messageId: number,
  channelId: number,
  fileId: string,
  mediaType?: MediaKind,
): Promise<string | null> {
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
  if (!channel?.type || channel.type !== "telegram") return null;

  const config = parseConfig(channel.config);
  if (!config.botToken) return null;

  const file = await downloadTelegramFile(config.botToken, fileId, mediaType);
  if (!file) return null;

  try {
    const saved = saveUpload(file.buffer, file.filename, file.mime);
    await db.update(schema.messages)
      .set({ mediaUrl: saved.url, mediaType: saved.mediaType })
      .where(eq(schema.messages.id, messageId));
    return saved.url;
  } catch {
    return null;
  }
}

export function parseTelegramFileId(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl?.startsWith("telegram:")) return null;
  return mediaUrl.slice("telegram:".length) || null;
}
