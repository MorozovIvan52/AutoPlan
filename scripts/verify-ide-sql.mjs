#!/usr/bin/env node
/** Ensures PostgreSQL scripts use .pgsql extension (IDE MSSQL linter). */
import { readdirSync, renameSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "scripts");
let renamed = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".sql")) continue;
  const path = join(dir, name);
  const head = readFileSync(path, "utf8").slice(0, 400);
  if (/ENABLE ROW LEVEL SECURITY|DO \$\$|current_setting|ALTER TABLE.*tenant_id/i.test(head)) {
    const dest = path.replace(/\.sql$/, ".pgsql");
    try {
      renameSync(path, dest);
      renamed++;
      console.log("renamed", name, "->", dest.split(/[/\\]/).pop());
    } catch { /* ignore */ }
  }
}
console.log(`verify-ide-sql: ${renamed} file(s) renamed`);
