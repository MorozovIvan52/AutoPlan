import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isProduction } from "./env";

const scryptAsync = promisify(scrypt);
const SCRYPT_PREFIX = "scrypt:";

function legacyPepper(): string | null {
  const salt = process.env.AUTH_SALT?.trim();
  return salt || null;
}

/** Legacy SHA-256 + pepper (миграция при входе). Requires AUTH_SALT — no hardcoded fallback. */
async function legacySha256(password: string): Promise<string | null> {
  const salt = legacyPepper();
  if (!salt) return null;
  const data = new TextEncoder().encode(password + salt);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function passwordMinLength(): number {
  return isProduction() ? 10 : 8;
}

export function passwordPolicy() {
  return {
    minLength: passwordMinLength(),
    requireLetterAndDigit: true,
    maxLength: 128,
  };
}

/** Хеш пароля (scrypt, per-user salt). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${SCRYPT_PREFIX}${salt}:${derived.toString("hex")}`;
}

async function verifyScrypt(password: string, stored: string): Promise<boolean> {
  const rest = stored.slice(SCRYPT_PREFIX.length);
  const colon = rest.indexOf(":");
  if (colon < 1) return false;
  const salt = rest.slice(0, colon);
  const expectedHex = rest.slice(colon + 1);
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

/** Проверка пароля; needsRehash=true для миграции со старого SHA-256. */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (storedHash.startsWith(SCRYPT_PREFIX)) {
    const ok = await verifyScrypt(password, storedHash);
    return { ok, needsRehash: false };
  }
  const legacy = await legacySha256(password);
  if (!legacy) return { ok: false, needsRehash: false };
  const ok = timingSafeEqualStrings(legacy, storedHash);
  return { ok, needsRehash: ok };
}

export function validatePasswordStrength(password: string, email?: string): string | null {
  const minLen = passwordMinLength();
  if (!password || password.length < minLen) return `Пароль не менее ${minLen} символов`;
  if (password.length > 128) return "Пароль слишком длинный";
  if (!/[a-zA-Zа-яА-ЯёЁ]/.test(password) || !/\d/.test(password)) {
    return "Пароль должен содержать букву и цифру";
  }
  const normalizedEmail = email?.trim().toLowerCase();
  if (normalizedEmail && password.toLowerCase() === normalizedEmail) {
    return "Пароль не должен совпадать с email";
  }
  return null;
}
