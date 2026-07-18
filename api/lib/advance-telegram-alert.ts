import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and } from "drizzle-orm";
import { parseConfig } from "./channel-config";
import { sendTelegramMessage } from "../integrations/telegram";

export async function sendAdvanceAlertTelegram(title: string, text: string, chatId?: string | null) {
  if (!chatId?.trim()) return false;

  const [channel] = await db.select().from(schema.channels).where(
    and(eq(schema.channels.type, "telegram"), eq(schema.channels.isActive, true)),
  );
  if (!channel) return false;

  const config = parseConfig(channel.config);
  if (!config.botToken) return false;

  const body = text ? `${title}\n\n${text}` : title;
  const res = await sendTelegramMessage(config, chatId.trim(), body);
  return res.ok;
}
