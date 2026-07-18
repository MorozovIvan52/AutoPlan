import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and } from "drizzle-orm";
import { parseConfig } from "../lib/channel-config";
import { parseTelegramUpdate } from "../integrations/telegram";
import { ingestIncoming } from "./messaging";

let offset = 0;

export function startTelegramPolling() {
  const enabled = process.env.TELEGRAM_POLLING_IN_APP === "true";
  const publicUrl = process.env.PUBLIC_URL || "http://localhost:4200";
  const isLocal = publicUrl.includes("localhost") || publicUrl.includes("127.0.0.1");

  if (process.env.TELEGRAM_BOT_API_ONLY === "true" && !enabled) {
    console.log("[telegram-poll] отключён (TELEGRAM_BOT_API_ONLY=true, webhook)");
    return;
  }
  if (!enabled && !isLocal) return;

  console.log("[telegram-poll] long polling запущен");

  let backoffMs = 1000;

  const loop = async () => {
    try {
      const channels = await db.select().from(schema.channels).where(
        and(eq(schema.channels.type, "telegram"), eq(schema.channels.isActive, true)),
      );
      for (const ch of channels) {
        const config = parseConfig(ch.config);
        if (!config.botToken) continue;

        const wh = await fetch(`https://api.telegram.org/bot${config.botToken}/getWebhookInfo`);
        const whData = await wh.json() as { ok?: boolean; result?: { url?: string } };
        if (whData.ok && whData.result?.url && process.env.TELEGRAM_POLLING_IN_APP !== "true") {
          continue;
        }

        const res = await fetch(
          `https://api.telegram.org/bot${config.botToken}/getUpdates?offset=${offset}&timeout=25`,
        );
        const data = await res.json() as any;
        if (!data.ok) continue;

        for (const update of data.result || []) {
          offset = update.update_id + 1;
          const parsed = parseTelegramUpdate(update);
          if (!parsed) continue;
          await ingestIncoming({
            channelId: ch.id,
            channelSlug: ch.slug,
            channelType: ch.type,
            ...parsed,
          });
        }
      }
      backoffMs = 1000;
    } catch (e: any) {
      console.error("[telegram-poll]", e.message);
      backoffMs = Math.min(backoffMs * 2, 60_000);
    }
    setTimeout(loop, backoffMs);
  };

  loop();
}
