import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { mediaPlaceholder, type MediaKind } from "./media";

export type ConvPreviewPatch = {
  lastMessageText: string | null;
  lastMessageSenderType: "client" | "operator" | "system";
  lastMessageId: number;
  lastMessageAt: Date;
};

export function previewTextFromMessage(msg: {
  text?: string | null;
  senderType: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
}): string {
  const t = (msg.text || "").trim();
  if (t) return t.slice(0, 500);
  if (msg.mediaUrl && msg.mediaType) return mediaPlaceholder(msg.mediaType as MediaKind);
  if (msg.mediaUrl) return "[медиа]";
  return "";
}

export function previewPatchFromMessage(msg: {
  id: number;
  text?: string | null;
  senderType: string;
  mediaUrl?: string | null;
  mediaType?: string | null;
  createdAt?: Date | null;
}): ConvPreviewPatch {
  return {
    lastMessageText: previewTextFromMessage(msg) || null,
    lastMessageSenderType: msg.senderType as ConvPreviewPatch["lastMessageSenderType"],
    lastMessageId: msg.id,
    lastMessageAt: msg.createdAt ?? new Date(),
  };
}

/** Обновить превью только если сообщение не старее текущего (защита от avito-poll). */
export async function updateConversationPreview(
  conversationId: number,
  msg: Parameters<typeof previewPatchFromMessage>[0],
) {
  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
  if (!conv) return;

  const msgAt = msg.createdAt ? new Date(msg.createdAt).getTime() : Date.now();
  const curId = conv.lastMessageId ?? 0;
  const curAt = conv.lastMessageAt ? new Date(conv.lastMessageAt).getTime() : 0;

  if (msg.id < curId) return;
  if (msg.id === curId && msgAt <= curAt) return;
  if (msg.id === curId && msgAt > curAt) {
    // тот же id, но уточнили время
  } else if (msgAt < curAt && msg.id <= curId) return;

  const patch = previewPatchFromMessage(msg);
  await db.update(schema.conversations).set(patch).where(eq(schema.conversations.id, conversationId));
}
