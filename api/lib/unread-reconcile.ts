import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, sql } from "drizzle-orm";
import { isSystemChatMessage } from "./chat-sla";

/** Сбрасывает непрочитанное, если ответ уже дан или последнее — системное. */
export async function reconcileConversationUnread(conversationId: number): Promise<boolean> {
  const [conv] = await db.select({
    unreadPinned: schema.conversations.unreadPinned,
  })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);
  if (conv?.unreadPinned) return false;

  const [last] = await db.select().from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(1);

  if (!last) return false;

  const shouldClear =
    last.senderType === "operator"
    || last.senderType === "system"
    || isSystemChatMessage(last.text);

  if (!shouldClear) return false;

  await db.update(schema.conversations)
    .set({ unreadCount: 0, unreadPinned: false })
    .where(eq(schema.conversations.id, conversationId));
  return true;
}

export async function reconcileChannelUnread(channelSlug: string): Promise<number> {
  const convs = await db.select({ id: schema.conversations.id, unreadCount: schema.conversations.unreadCount })
    .from(schema.conversations)
    .where(eq(schema.conversations.channelType, channelSlug));

  let fixed = 0;
  for (const conv of convs) {
    if ((conv.unreadCount || 0) <= 0) continue;
    if (await reconcileConversationUnread(conv.id)) fixed++;
  }
  return fixed;
}

/** Массовая сверка всех диалогов с непрочитанными. */
export async function reconcileAllStaleUnread(): Promise<number> {
  const convs = await db.select({ id: schema.conversations.id })
    .from(schema.conversations)
    .where(sql`${schema.conversations.unreadCount} > 0`);

  let fixed = 0;
  for (const conv of convs) {
    if (await reconcileConversationUnread(conv.id)) fixed++;
  }
  return fixed;
}
