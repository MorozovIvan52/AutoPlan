import "../load-env.ts";
import { getZzapSettings, uploadAllZzapPriceLists, uploadZzapPriceList } from "../api/lib/zzap";
import { db } from "../api/database";
import * as schema from "../api/database/schema";
import { and, asc, eq } from "drizzle-orm";
import { forTenant } from "../api/lib/tenant-query";
import { zzapPublicFileUrl } from "../api/integrations/zzap";
import { writeFileSync } from "node:fs";

async function main() {
  process.env.PUBLIC_URL = "https://crmavito.online";
  const s = await getZzapSettings();

  // 1) bump files + verify links
  const lists = await db
    .select()
    .from(schema.zzapPriceLists)
    .where(and(forTenant(schema.zzapPriceLists), eq(schema.zzapPriceLists.enabled, true)))
    .orderBy(asc(schema.zzapPriceLists.sortOrder));

  const urls: { id: number; name: string; code: number; url: string }[] = [];
  for (const list of lists) {
    if (!list.storedFileName || !list.codeTemplate) continue;
    await new Promise((r) => setTimeout(r, 1100));
    const result = await uploadZzapPriceList(list.id);
    const url = zzapPublicFileUrl(list.codeTemplate)!;
    urls.push({ id: list.id, name: list.name, code: list.codeTemplate, url });
    console.log("crm", JSON.stringify({ name: list.name, result }));
  }

  writeFileSync("/tmp/zzap-push-meta.json", JSON.stringify({
    login: s.login,
    password: s.password,
    urls,
  }));

  console.log("META_OK", urls.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
