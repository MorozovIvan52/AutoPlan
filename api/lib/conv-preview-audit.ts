import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc } from "drizzle-orm";
import { previewPatchFromMessage } from "./conv-preview";
import { sqlGet } from "../database/raw-sql";

/** Диалоги, где превью не совпадает с последним сообщением в БД. */
export async function countPreviewDesync(): Promise<number> {
  const row = await sqlGet<{ n: number }>(`
    SELECT COUNT(*) AS n FROM conversations c
    WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      AND c.last_message_id IS NOT NULL
      AND c.last_message_id != (
        SELECT MAX(id) FROM messages WHERE conversation_id = c.id
      )
  `);
  return row?.n ?? 0;
}

/** Восстановить превью по последнему сообщению. */
export async function repairConversationPreviews(onlyConversationId?: number): Promise<number> {
  const convs = onlyConversationId
    ? await db.select().from(schema.conversations).where(eq(schema.conversations.id, onlyConversationId))
    : await db.select().from(schema.conversations);

  let fixed = 0;
  for (const conv of convs) {
    const [latest] = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(desc(schema.messages.id))
      .limit(1);
    if (!latest || conv.lastMessageId === latest.id) continue;

    await db.update(schema.conversations)
      .set(previewPatchFromMessage(latest))
      .where(eq(schema.conversations.id, conv.id));
    fixed++;
  }
  return fixed;
}
