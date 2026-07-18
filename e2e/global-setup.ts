/**
 * Playwright global setup: БД + E2E admin user перед всеми тестами.
 */
import { execSync } from "node:child_process";
import { existsSync, unlinkSync } from "node:fs";

const DB = process.env.CRM_DB_PATH || "crm-e2e.db";

export default async function globalSetup() {
  process.env.CRM_DB_PATH = DB;
  process.env.NODE_ENV = process.env.NODE_ENV || "test";
  process.env.TELEGRAM_POLLING_IN_APP = "false";
  process.env.AVITO_POLL_INTERVAL_SECONDS = "9999";
  // E2E всегда на локальном SQLite, даже если в .env есть DATABASE_URL (docker host `db`)
  delete process.env.DATABASE_URL;
  process.env.CRM_FORCE_SQLITE = "1";

  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) {
    if (existsSync(f)) try { unlinkSync(f); } catch { /* */ }
  }

  console.log("[e2e setup] drizzle push...");
  execSync("npx drizzle-kit push --force", { stdio: "inherit", env: process.env });

  console.log("[e2e setup] prod setup...");
  execSync("npx tsx scripts/prod-setup.ts", { stdio: "inherit", env: process.env });

  console.log("[e2e setup] admin user...");
  execSync("npx tsx scripts/e2e-user.ts", { stdio: "inherit", env: process.env });

  console.log("[e2e setup] sto extended tables...");
  execSync("npx tsx scripts/e2e-sto-bootstrap.ts", { stdio: "inherit", env: process.env });

  console.log("[e2e setup] done");
}
