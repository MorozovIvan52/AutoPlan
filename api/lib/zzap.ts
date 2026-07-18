import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, utimesSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, asc } from "drizzle-orm";
import { uploadZzapTemplatePrice, isZzapNewApiKey, verifyZzapExternalUrl, zzapPublicFileUrl } from "../integrations/zzap";
import { getPublicUrl } from "./config";
import { forTenant, tenantId, withTenant } from "./tenant-query";

const PRICE_DIR = process.env.ZZAP_PRICE_DIR || join(process.cwd(), "data", "zzap-prices");
const ALLOWED_EXT = new Set([".xls", ".xlsx", ".xltx", ".zip", ".arj", ".7z", ".gz", ".txt", ".csv", ".xml", ".yml", ".dbf"]);

export function ensureZzapPriceDir() {
  if (!existsSync(PRICE_DIR)) mkdirSync(PRICE_DIR, { recursive: true });
}

export function zzapPriceDir() {
  ensureZzapPriceDir();
  return PRICE_DIR;
}

export function maskZzapSecret(s?: string | null) {
  if (!s) return null;
  if (s.length <= 6) return "••••••";
  return s.slice(0, 3) + "••••" + s.slice(-3);
}

export async function getZzapSettings() {
  const [row] = await db.select().from(schema.zzapSettings).where(forTenant(schema.zzapSettings)).limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.zzapSettings).values({ tenantId: tenantId() }).returning();
  return created;
}

export function isZzapConfigured(settings: typeof schema.zzapSettings.$inferSelect) {
  if (!settings.enabled || !settings.login || !settings.password) return false;
  if (settings.apiKey) return true;
  return false;
}

export function usesZzapExternalLinkMode(settings: typeof schema.zzapSettings.$inferSelect) {
  return isZzapNewApiKey(settings.apiKey);
}

export function touchZzapPriceFile(storedName: string, _fileName?: string | null, _codeTemplate?: number | null) {
  const path = join(zzapPriceDir(), storedName);
  const now = new Date();
  try {
    // Только mtime: перепись xlsx (bump/patch) портила прайсы муфт/раздаток на ZZap.
    // ZZap в режиме внешней ссылки сам перечитывает URL по расписанию / кнопке «Обновить».
    utimesSync(path, now, now);
  } catch { /* */ }
}

/** Отдача ZZap: файл уже пропатчен в touchZzapPriceFile — повторный патч отменял бы изменения. */
export function prepareZzapPriceFileForDownload(buffer: Buffer, _fileName?: string | null): Buffer {
  return buffer;
}

export function readZzapPriceFile(storedName: string): Buffer | null {
  const path = join(zzapPriceDir(), storedName);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

export function saveZzapPriceFile(buffer: Buffer, originalName: string): { storedName: string; fileName: string } {
  ensureZzapPriceDir();
  const ext = extname(originalName).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(`Формат не поддерживается ZZap: ${ext || "без расширения"}`);
  }
  const storedName = `${randomUUID()}${ext}`;
  writeFileSync(join(PRICE_DIR, storedName), buffer);
  return { storedName, fileName: basename(originalName) || `price${ext}` };
}

export function deleteZzapPriceFile(storedName: string | null | undefined) {
  if (!storedName) return;
  const path = join(zzapPriceDir(), storedName);
  if (existsSync(path)) unlinkSync(path);
}

export async function uploadZzapPriceList(listId: number): Promise<{ ok: boolean; error?: string; fileUrl?: string }> {
  const settings = await getZzapSettings();
  if (!isZzapConfigured(settings)) {
    return { ok: false, error: "ZZap не настроен — укажите логин, пароль и API-ключ" };
  }

  const [list] = await db.select().from(schema.zzapPriceLists)
    .where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, listId)));
  if (!list) return { ok: false, error: "Прайс не найден" };
  if (!list.enabled) return { ok: false, error: "Прайс отключён" };
  if (!list.codeTemplate) return { ok: false, error: "Укажите код шаблона ZZap (code_templ)" };
  if (!list.storedFileName) return { ok: false, error: "Файл прайса не загружен" };

  const buffer = readZzapPriceFile(list.storedFileName);
  if (!buffer) return { ok: false, error: "Файл прайса не найден на сервере" };

  const publicFileUrl = list.codeTemplate ? zzapPublicFileUrl(list.codeTemplate) || undefined : undefined;

  if (usesZzapExternalLinkMode(settings)) {
    if (!publicFileUrl) {
      return { ok: false, error: "Нужен HTTPS (PUBLIC_URL=https://crmavito.online) для внешней ссылки" };
    }
    touchZzapPriceFile(list.storedFileName, list.fileName, list.codeTemplate);
    const check = await verifyZzapExternalUrl(publicFileUrl);
    const now = new Date();
    if (!check.ok) {
      await db.update(schema.zzapPriceLists).set({
        lastUploadError: check.error,
        updatedAt: now,
      }).where(eq(schema.zzapPriceLists.id, listId));
      return { ok: false, error: check.error };
    }
    await db.update(schema.zzapPriceLists).set({
      lastUploadedAt: now,
      lastUploadError: null,
      updatedAt: now,
    }).where(eq(schema.zzapPriceLists.id, listId));
    await db.update(schema.zzapSettings).set({
      lastRunAt: now,
      lastRunStatus: "ok",
      lastRunError: null,
      updatedAt: now,
    }).where(eq(schema.zzapSettings.id, settings.id));
    return { ok: true, fileUrl: publicFileUrl };
  }

  if (!settings.apiKey) {
    return { ok: false, error: "Укажите API-ключ ZZap или ключ zzap1_… (режим внешней ссылки)" };
  }

  const result = await uploadZzapTemplatePrice({
    login: settings.login!,
    password: settings.password!,
    apiKey: settings.apiKey!,
    codeTemplate: list.codeTemplate,
    fileName: list.fileName || "price.xlsx",
    fileBuffer: buffer,
    publicFileUrl,
  });

  const now = new Date();
  await db.update(schema.zzapPriceLists).set({
    lastUploadedAt: result.ok ? now : list.lastUploadedAt,
    lastUploadError: result.ok ? null : (result.error || "Ошибка загрузки"),
    updatedAt: now,
  }).where(eq(schema.zzapPriceLists.id, listId));

  if (result.ok) {
    await db.update(schema.zzapSettings).set({
      lastRunAt: now,
      lastRunStatus: "ok",
      lastRunError: null,
      updatedAt: now,
    }).where(eq(schema.zzapSettings.id, settings.id));
  }

  return result;
}

export async function uploadAllZzapPriceLists(): Promise<{ uploaded: number; failed: number; errors: string[] }> {
  const settings = await getZzapSettings();
  if (!settings.autoUploadEnabled || !isZzapConfigured(settings)) {
    return { uploaded: 0, failed: 0, errors: [] };
  }

  const lists = await db.select().from(schema.zzapPriceLists)
    .where(and(forTenant(schema.zzapPriceLists), eq(schema.zzapPriceLists.enabled, true)))
    .orderBy(asc(schema.zzapPriceLists.sortOrder));

  let uploaded = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const list of lists) {
    if (!list.storedFileName || !list.codeTemplate) continue;
    const result = await uploadZzapPriceList(list.id);
    if (result.ok) {
      uploaded++;
    } else {
      failed++;
      errors.push(`${list.name}: ${result.error}`);
    }
    await new Promise((r) => setTimeout(r, 3500));
  }

  const now = new Date();
  await db.update(schema.zzapSettings).set({
    lastRunAt: now,
    lastRunStatus: failed === 0 ? "ok" : (uploaded > 0 ? "partial" : "error"),
    lastRunError: errors.length ? errors.join("; ") : null,
    updatedAt: now,
  }).where(withTenant(schema.zzapSettings, eq(schema.zzapSettings.id, settings.id)));

  return { uploaded, failed, errors };
}
