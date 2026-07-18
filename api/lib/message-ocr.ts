import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, isNull, sql } from "drizzle-orm";
import { resolveMessageMedia } from "./message-media";
import { ocrImageBufferText, normalizeOcrText } from "./ocr-buffer";

const OCR_ENABLED = process.env.MESSAGE_OCR_ENABLED !== "false";
const PHOTO_TYPES = new Set(["photo", "image"]);

export async function ocrMessageById(messageId: number): Promise<string | null> {
  if (!OCR_ENABLED) return null;

  const [message] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
  if (!message?.mediaUrl || !PHOTO_TYPES.has(message.mediaType || "")) return null;
  if (message.ocrText) return message.ocrText;

  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, message.conversationId));
  if (!conv) return null;

  const media = await resolveMessageMedia(message, conv);
  if (!media?.buffer?.length) return null;

  try {
    const text = normalizeOcrText(await ocrImageBufferText(media.buffer)).slice(0, 4000);
    if (!text) return null;

    await db.update(schema.messages)
      .set({ ocrText: text })
      .where(eq(schema.messages.id, messageId));

    return text;
  } catch (e: any) {
    console.warn(`[ocr] msg #${messageId}:`, e.message);
    return null;
  }
}

export function scheduleMessageOcr(messageId: number, mediaType?: string | null) {
  if (!OCR_ENABLED || !mediaType || !PHOTO_TYPES.has(mediaType)) return;
  setTimeout(() => {
    ocrMessageById(messageId).catch(() => {});
  }, 500);
}

export async function backfillMessageOcr(limit = 50): Promise<{ processed: number; indexed: number }> {
  if (!OCR_ENABLED) return { processed: 0, indexed: 0 };

  const rows = await db.select().from(schema.messages).where(
    and(
      sql`${schema.messages.mediaType} IN ('photo', 'image')`,
      isNull(schema.messages.ocrText),
      sql`${schema.messages.mediaUrl} IS NOT NULL`,
    ),
  ).limit(limit);

  let indexed = 0;
  for (const row of rows) {
    const text = await ocrMessageById(row.id);
    if (text) indexed++;
    await new Promise((r) => setTimeout(r, 300));
  }
  return { processed: rows.length, indexed };
}
