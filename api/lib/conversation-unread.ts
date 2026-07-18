import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { broadcast } from "../services/ws";
import { sqlExec, tableColumns, usePostgres } from "../database/raw-sql";

async function ensureUnreadPinnedColumn(): Promise<void> {
  if (usePostgres()) return;
  const rows = await tableColumns("conversations");
  if (!rows.some((r) => r.name === "unread_pinned")) {
    await sqlExec("ALTER TABLE conversations ADD COLUMN unread_pinned INTEGER DEFAULT 0");
  }
}

/** Сброс непрочитанного (просмотр диалога, ответ оператора). */
export async function clearConversationUnread(conversationId: number): Promise<void> {
  await ensureUnreadPinnedColumn();
  await db.update(schema.conversations)
    .set({ unreadCount: 0, unreadPinned: false })
    .where(eq(schema.conversations.id, conversationId));
}

/** Ручная пометка «непрочитано» — держится при синхронизации Авито. */
export async function pinConversationUnread(conversationId: number): Promise<{ unreadCount: number }> {
  await ensureUnreadPinnedColumn();

  const [conv] = await db.select({
    id: schema.conversations.id,
    unreadCount: schema.conversations.unreadCount,
  })
    .from(schema.conversations)
    .where(eq(schema.conversations.id, conversationId))
    .limit(1);

  if (!conv) throw new Error("Диалог не найден");

  const unreadCount = Math.max(1, conv.unreadCount || 0);
  await db.update(schema.conversations)
    .set({ unreadCount, unreadPinned: true })
    .where(eq(schema.conversations.id, conversationId));

  broadcast({ type: "conversation_unread", conversationId, unreadCount });
  return { unreadCount };
}
