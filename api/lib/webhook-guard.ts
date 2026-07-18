import type { Context } from "hono";
import { parseConfig } from "./channel-config";
import { isProduction, isPublicDeployment } from "./env";
import { timingSafeEqualText } from "../middleware/security";

type ChannelRow = { config: string | null };

/** Проверка секрета канала (Telegram secret_token, generic и др.). */
export function verifyChannelWebhookSecret(
  c: Context,
  channel: ChannelRow,
  opts?: { headerNames?: string[]; requireInProduction?: boolean },
): boolean {
  const config = parseConfig(channel.config);
  const secret = config.webhookSecret?.trim();
  if (!secret) {
    if ((isProduction() || isPublicDeployment()) && opts?.requireInProduction) return false;
    return true;
  }

  const headers = opts?.headerNames ?? ["x-webhook-secret", "x-telegram-bot-api-secret-token"];
  for (const name of headers) {
    const v = c.req.header(name);
    if (v && timingSafeEqualText(v, secret)) return true;
  }
  return false;
}
