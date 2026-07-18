import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { parseConfig } from "./channel-config";
import { markAvitoChatRead } from "../integrations/avito";

/** Помечает чат прочитанным в Авито (снимает «не отвечено» в мессенджере). */
export async function markAvitoConversationRead(
  channelId: number | null | undefined,
  channelSlug: string,
  externalChatId: string | null | undefined,
): Promise<void> {
  if (!externalChatId) return;

  const [channel] = channelId
    ? await db.select().from(schema.channels).where(eq(schema.channels.id, channelId)).limit(1)
    : await db.select().from(schema.channels).where(eq(schema.channels.slug, channelSlug)).limit(1);

  if (!channel || channel.type !== "avito") return;

  const config = parseConfig(channel.config);
  const result = await markAvitoChatRead(config, externalChatId);
  if (!result.ok) {
    console.warn(`[avito/read] ${channel.slug}/${externalChatId.slice(0, 12)}: ${result.error}`);
  }
}
