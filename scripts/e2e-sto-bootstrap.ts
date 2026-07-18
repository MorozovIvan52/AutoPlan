/**
 * E2E: расширенные таблицы СТО (labor catalog, diagnostics, …).
 */
import "../load-env.ts";
import { ensureStoExtendedTables } from "../api/lib/sto-extended-bootstrap.ts";
import { closeDatabase } from "../api/database/index.ts";

async function main() {
  await ensureStoExtendedTables();
  console.log("[e2e-sto-bootstrap] OK");
}

main()
  .catch((e) => {
    console.error("[e2e-sto-bootstrap]", e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
