import { createHmac, timingSafeEqual } from "node:crypto";
import { timingSafeEqualText } from "../middleware/security";

/** Avito Messenger v3: x-avito-messenger-signature = HMAC-SHA256(secret, rawBody) */
export function verifyAvitoMessengerSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  const sig = signatureHeader?.trim();
  if (!sig || !secret.trim()) return false;

  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Принимает HMAC-подпись Avito, явный secret в заголовке или ?token= в URL. */
export function verifyAvitoWebhookAuth(
  rawBody: string,
  secret: string,
  headers: {
    messengerSignature?: string | null;
    plainSecret?: string | null;
    queryToken?: string | null;
  },
): boolean {
  const trimmed = secret.trim();
  if (!trimmed) return false;

  if (headers.queryToken && timingSafeEqualText(headers.queryToken, trimmed)) {
    return true;
  }

  if (headers.plainSecret && timingSafeEqualText(headers.plainSecret, trimmed)) {
    return true;
  }

  return verifyAvitoMessengerSignature(rawBody, headers.messengerSignature ?? undefined, trimmed);
}
