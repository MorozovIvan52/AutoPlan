import type { Context } from "hono";
import { timingSafeEqualText } from "../middleware/security";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { verifyZzapExternalUrl, zzapPublicFileUrl } from "../integrations/zzap";
import { getZzapSettings, usesZzapExternalLinkMode } from "./zzap";

/**
 * Публичная отдача прайсов для ZZap (внешняя ссылка).
 * - /template/:code — основной URL для кабинета; без токена допускается (код шаблона не sequential id).
 * - /files/:id — только с ZZAP_PUBLIC_TOKEN (иначе перебор id чужих тенантов).
 */
export function checkZzapPublicAccess(c: Context, opts?: { requireToken?: boolean }): boolean {
  const token = process.env.ZZAP_PUBLIC_TOKEN?.trim();
  const provided = c.req.query("t") || c.req.header("x-zzap-token") || "";
  if (opts?.requireToken) {
    if (!token) return false;
    return provided ? timingSafeEqualText(provided, token) : false;
  }
  if (!token) return true;
  return provided ? timingSafeEqualText(provided, token) : false;
}

/** При старте — предупреждение, если ZZap не сможет скачать прайсы. */
export async function warnIfZzapPublicUrlsBroken(): Promise<void> {
  try {
    const settings = await getZzapSettings();
    if (!settings.enabled || !usesZzapExternalLinkMode(settings)) return;

    const lists = await db.select().from(schema.zzapPriceLists).where(eq(schema.zzapPriceLists.enabled, true));
    const broken: string[] = [];

    for (const list of lists) {
      if (!list.codeTemplate || !list.storedFileName) continue;
      const url = zzapPublicFileUrl(list.codeTemplate);
      if (!url) {
        broken.push(`${list.name}: нет HTTPS PUBLIC_URL`);
        continue;
      }
      const check = await verifyZzapExternalUrl(url);
      if (!check.ok) broken.push(`${list.name}: ${check.error} (${url})`);
    }

    if (broken.length) {
      console.error("[zzap] Публичные ссылки прайсов недоступны для ZZap:\n  " + broken.join("\n  "));
    } else if (lists.length) {
      console.log(`[zzap] Публичные ссылки OK (${lists.length} прайсов)`);
    }
  } catch (e: any) {
    console.error("[zzap] проверка публичных ссылок:", e.message);
  }
}
