import { createHash, randomInt } from "node:crypto";
import { db } from "../database";
import * as schema from "../database/schema";
import { and, eq, gt } from "drizzle-orm";
import { normalizePhone } from "./phone";
import { sendSms, smsConfigured } from "./sms";
import { getOfferVersion } from "./license-offer-text";

export function hashOtpCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

export function generateOtpCode(): string {
  return String(randomInt(100000, 999999));
}

export async function tenantOfferAccepted(tenantId: number): Promise<boolean> {
  const [t] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId));
  if (!t?.offerAcceptedAt) return false;
  return (t.offerVersion || "") === getOfferVersion();
}

export function offerRequiredForUser(user: { role?: string | null }): boolean {
  if (user.role === "demo") return false;
  return true;
}

export async function sendOfferOtp(opts: {
  tenantId: number;
  userId: number;
  phoneRaw: string;
}): Promise<{ ok: true; phone: string; debugCode?: string } | { ok: false; error: string }> {
  const phone = normalizePhone(opts.phoneRaw);
  if (phone.length < 11) return { ok: false, error: "Укажите номер в формате +7…" };

  const recent = await db.select().from(schema.licenseOfferOtps)
    .where(and(
      eq(schema.licenseOfferOtps.tenantId, opts.tenantId),
      eq(schema.licenseOfferOtps.phone, phone),
      gt(schema.licenseOfferOtps.createdAt, new Date(Date.now() - 60_000)),
    ))
    .limit(1);
  if (recent.length) return { ok: false, error: "Подождите минуту перед повторной отправкой SMS" };

  const code = generateOtpCode();
  const expiresAt = new Date(Date.now() + 10 * 60_000);

  await db.delete(schema.licenseOfferOtps).where(and(
    eq(schema.licenseOfferOtps.tenantId, opts.tenantId),
    eq(schema.licenseOfferOtps.userId, opts.userId),
  ));

  await db.insert(schema.licenseOfferOtps).values({
    tenantId: opts.tenantId,
    userId: opts.userId,
    phone,
    codeHash: hashOtpCode(code),
    attempts: 0,
    expiresAt,
  });

  const msg = `CRM АвтоПлан: код подтверждения оферты ${code}. Действует 10 минут.`;

  if (!smsConfigured()) {
    if (process.env.NODE_ENV === "production" && process.env.ALLOW_OFFER_OTP_WITHOUT_SMS !== "1") {
      return { ok: false, error: "SMS не настроено (SMS_API_ID). Обратитесь к администратору." };
    }
    console.warn(`[license-offer] SMS не настроено, код для ${phone}: ${code}`);
    return { ok: true, phone, debugCode: code };
  }

  const sent = await sendSms(phone, msg);
  if (!sent.ok) return { ok: false, error: sent.error || "Не удалось отправить SMS" };
  return { ok: true, phone };
}

export async function confirmOfferOtp(opts: {
  tenantId: number;
  userId: number;
  phoneRaw: string;
  code: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const phone = normalizePhone(opts.phoneRaw);
  const code = (opts.code || "").replace(/\D/g, "");
  if (code.length !== 6) return { ok: false, error: "Введите 6‑значный код из SMS" };

  const [row] = await db.select().from(schema.licenseOfferOtps)
    .where(and(
      eq(schema.licenseOfferOtps.tenantId, opts.tenantId),
      eq(schema.licenseOfferOtps.userId, opts.userId),
      eq(schema.licenseOfferOtps.phone, phone),
    ))
    .limit(1);

  if (!row) return { ok: false, error: "Сначала запросите код на этот номер" };
  if (row.expiresAt < new Date()) {
    await db.delete(schema.licenseOfferOtps).where(eq(schema.licenseOfferOtps.id, row.id));
    return { ok: false, error: "Код истёк — запросите новый" };
  }
  if ((row.attempts || 0) >= 5) {
    await db.delete(schema.licenseOfferOtps).where(eq(schema.licenseOfferOtps.id, row.id));
    return { ok: false, error: "Слишком много попыток — запросите новый код" };
  }

  if (row.codeHash !== hashOtpCode(code)) {
    await db.update(schema.licenseOfferOtps)
      .set({ attempts: (row.attempts || 0) + 1 })
      .where(eq(schema.licenseOfferOtps.id, row.id));
    return { ok: false, error: "Неверный код" };
  }

  await db.update(schema.tenants).set({
    offerAcceptedAt: new Date(),
    offerAcceptedPhone: phone,
    offerAcceptedByUserId: opts.userId,
    offerVersion: getOfferVersion(),
  }).where(eq(schema.tenants.id, opts.tenantId));

  await db.delete(schema.licenseOfferOtps).where(eq(schema.licenseOfferOtps.id, row.id));
  return { ok: true };
}
