import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta WhatsApp Cloud API: X-Hub-Signature-256 */
export function verifyWhatsAppSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const expected = signatureHeader.slice(7);
  const hmac = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const a = Buffer.from(hmac);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
