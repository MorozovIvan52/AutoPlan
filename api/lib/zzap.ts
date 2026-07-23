import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { join, extname, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, asc } from "drizzle-orm";
import { uploadZzapTemplatePrice, isZzapNewApiKey, verifyZzapExternalUrl, zzapPublicFileUrl } from "../integrations/zzap";
import { patchZzapXlsxInPlace, isZzapBumpableFile } from "./zzap-bump";
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
  if (!settings.enabled) return false;
  // Режим по ссылке (как раньше): ключ не обязателен / zzap1_ только маркер
  if (!settings.apiKey || isZzapNewApiKey(settings.apiKey)) return true;
  return Boolean(settings.login && settings.password && settings.apiKey);
}

/** Внешняя ссылка CRM → ZZap сам качает файл. Без UploadTemplatePrice / b52. */
export function usesZzapExternalLinkMode(settings: typeof schema.zzapSettings.$inferSelect) {
  if (!settings.apiKey) return true;
  return isZzapNewApiKey(settings.apiKey);
}

/**
 * Перед отправкой на ZZap: меняем D (наличие/+) и F (В наличии/В наличие) по чётности —
 * ZZap считает это изменением контента. Пробелы в пустых ячейках он игнорирует («без изменений»).
 */
export function touchZzapPriceFile(storedName: string, fileName?: string | null, _codeTemplate?: number | null) {
  const path = join(zzapPriceDir(), storedName);
  try {
    const buf = readFileSync(path);
    if (!isZzapBumpableFile(fileName || storedName)) return;
    writeFileSync(path, patchZzapXlsxInPlace(buf, storedName));
  } catch { /* */ }
}

/** Отдаём файл как сохранён на диске (пробел уже проставлен в touch). */
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
    return { ok: false, error: "ZZap не настроен — включите интеграцию" };
  }

  const [list] = await db.select().from(schema.zzapPriceLists)
    .where(withTenant(schema.zzapPriceLists, eq(schema.zzapPriceLists.id, listId)));
  if (!list) return { ok: false, error: "Прайс не найден" };
  if (!list.enabled) return { ok: false, error: "Прайс отключён" };
  if (!list.codeTemplate) return { ok: false, error: "Укажите код шаблона ZZap (code_templ)" };
  if (!list.storedFileName) return { ok: false, error: "Файл прайса не загружен" };

  if (!readZzapPriceFile(list.storedFileName)) {
    return { ok: false, error: "Файл прайса не найден на сервере" };
  }

  const publicFileUrl = list.codeTemplate ? zzapPublicFileUrl(list.codeTemplate) || undefined : undefined;

  // Как раньше: по внешней ссылке — пробел в пустой ячейке, сохранить, ZZap качает URL сам
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
    return { ok: false, error: "Укажите API-ключ ZZap" };
  }

  touchZzapPriceFile(list.storedFileName, list.fileName, list.codeTemplate);
  const bufferFresh = readZzapPriceFile(list.storedFileName);
  if (!bufferFresh) return { ok: false, error: "Файл прайса не найден на сервере после touch" };

  const result = await uploadZzapTemplatePrice({
    login: settings.login!,
    password: settings.password!,
    apiKey: settings.apiKey!,
    codeTemplate: list.codeTemplate,
    fileName: list.fileName || "price.xlsx",
    fileBuffer: bufferFresh,
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
  } else {
    await db.update(schema.zzapSettings).set({
      lastRunAt: now,
      lastRunStatus: "error",
      lastRunError: result.error || "Ошибка загрузки",
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
