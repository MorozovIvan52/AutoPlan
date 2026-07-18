/**
 * Production / CI DB bootstrap: schema extensions + indexes + SaaS tables.
 * После drizzle-kit push или на существующей SQLite/Postgres.
 */
import "../load-env.ts";
import { ensureAllDbBootstrap, ensureSaasOnStartup } from "../api/lib/db-bootstrap.ts";
import { ensureSaasCompositeUniques } from "../api/lib/saas-unique-bootstrap.ts";
import { usePostgres } from "../api/database/raw-sql.ts";
import { closeDatabase } from "../api/database/index.ts";

async function main() {
  const mode = usePostgres() ? "PostgreSQL" : `SQLite (${process.env.CRM_DB_PATH || "crm.db"})`;
  console.log(`[setup:prod] База: ${mode}`);
  await ensureAllDbBootstrap();
  await ensureSaasOnStartup();
  await ensureSaasCompositeUniques();
  console.log("[setup:prod] Готово");
}

main()
  .catch((e) => {
    console.error("[setup:prod] Ошибка:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
