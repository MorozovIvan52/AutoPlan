import { readdirSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { patchZzapXlsxInPlace, isZzapBumpableFile } from "/opt/crm/api/lib/zzap-bump.ts";

const root = "/opt/crm/data/zzap-prices";
for (const name of readdirSync(root)) {
  if (!isZzapBumpableFile(name) && !/\.xlsx$/i.test(name)) continue;
  const p = join(root, name);
  const before = readFileSync(p);
  const after = patchZzapXlsxInPlace(before, name);
  writeFileSync(p, after);
  console.log("patched", name, before.length, "->", after.length);
}
