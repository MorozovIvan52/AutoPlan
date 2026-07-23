/**
 * SQLite → PostgreSQL migration (data + schema from live SQLite).
 *
 * Does NOT deploy to VPS. Does NOT modify/delete crm.db.
 *
 * Usage:
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --dry-run
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts
 *   npx tsx scripts/migrate-sqlite-to-postgres.ts --force   # wipe existing PG public tables first
 *
 * Env:
 *   CRM_DB_PATH   — source SQLite (default: crm.db)
 *   DATABASE_URL  — target Postgres (required)
 *
 * Pitfalls handled:
 *   - Dual-driver opens only one engine → open SQLite + pg.Pool separately
 *   - Bootstrap tables missing from Drizzle → create from PRAGMA introspection
 *   - INTEGER timestamps / 0|1 flags → BIGINT (app-compatible)
 *   - TEXT PKs (sessions, stripe_webhook_events)
 *   - Preserve original IDs → reset sequences after load
 *   - Load without FKs first (CREATE without REFERENCES) to avoid order failures
 *   - Refuse non-empty target unless --force
 *   - Migration must run BEFORE setup-postgres-rls.pgsql (or with a BYPASSRLS role)
 */
import "../load-env.ts";
import type Database from "better-sqlite3";
import type { PoolClient } from "pg";
import {
  BATCH_SIZE,
  buildCreateTableSql,
  convertCell,
  ensureIdSequence,
  listSqliteTables,
  openPgPool,
  openSqliteReadonly,
  orderedTables,
  parseArgs,
  pgRowCount,
  pgTableExists,
  quoteIdent,
  sqliteRowCount,
  tableColumns,
  type SqliteColumn,
} from "./lib/sqlite-pg-migrate-utils.ts";

function printHelp() {
  console.log(`migrate-sqlite-to-postgres.ts

Copies schema+data from SQLite into Postgres. Never touches VPS by itself.

  --dry-run   Plan only (connect + counts + CREATE preview). No writes.
  --force     TRUNCATE existing public tables (CASCADE) before load.
  --help      This text.

Required: DATABASE_URL
Optional: CRM_DB_PATH (default crm.db)

After success (on the server, when owner says «готов к Postgres»):
  1) npm run verify:postgres
  2) psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql
  3) npm run pg:ensure-modules && npm run verify:pg-modules
  4) Keep crm.db ≥ 7 days for rollback (unset DATABASE_URL + pm2 restart)
`);
}

async function assertTargetSafe(client: PoolClient, force: boolean): Promise<void> {
  const tenantsExist = await pgTableExists(client, "tenants");
  if (!tenantsExist) return;
  const n = await pgRowCount(client, "tenants");
  if (n > 0 && !force) {
    throw new Error(
      `Target Postgres already has ${n} row(s) in tenants. ` +
        `Refusing to overwrite. Re-run with --force to TRUNCATE, or use an empty database.`,
    );
  }
}

async function truncateAllPublic(client: PoolClient): Promise<void> {
  const res = await client.query<{ tablename: string }>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  if (!res.rows.length) return;
  const list = res.rows.map((r) => quoteIdent(r.tablename)).join(", ");
  await client.query(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  console.log(`[migrate] TRUNCATE ${res.rows.length} public table(s) (CASCADE)`);
}

async function createSchemaFromSqlite(
  client: PoolClient,
  sqlite: Database.Database,
  tables: string[],
  dryRun: boolean,
): Promise<Map<string, SqliteColumn[]>> {
  const meta = new Map<string, SqliteColumn[]>();
  for (const table of tables) {
    const cols = tableColumns(sqlite, table);
    if (!cols.length) {
      console.warn(`[migrate] skip empty pragma: ${table}`);
      continue;
    }
    meta.set(table, cols);
    const ddl = buildCreateTableSql(table, cols);
    if (dryRun) {
      console.log(`[dry-run] would CREATE ${table} (${cols.length} cols)`);
      continue;
    }
    await client.query(ddl);
  }
  return meta;
}

async function copyTable(
  client: PoolClient,
  sqlite: Database.Database,
  table: string,
  cols: SqliteColumn[],
  dryRun: boolean,
): Promise<{ sqliteRows: number; inserted: number }> {
  const sqliteRows = sqliteRowCount(sqlite, table);
  if (dryRun) {
    return { sqliteRows, inserted: 0 };
  }
  if (sqliteRows === 0) return { sqliteRows, inserted: 0 };

  const colNames = cols.map((c) => c.name);
  const qCols = colNames.map(quoteIdent).join(", ");
  const selectSql = `SELECT ${colNames.map(quoteIdent).join(", ")} FROM ${quoteIdent(table)}`;
  const stmt = sqlite.prepare(selectSql);

  let inserted = 0;
  let batch: unknown[][] = [];

  const flush = async () => {
    if (!batch.length) return;
    const width = colNames.length;
    const valuesSql: string[] = [];
    const params: unknown[] = [];
    for (let r = 0; r < batch.length; r++) {
      const placeholders: string[] = [];
      for (let c = 0; c < width; c++) {
        params.push(batch[r]![c]);
        placeholders.push(`$${params.length}`);
      }
      valuesSql.push(`(${placeholders.join(", ")})`);
    }
    await client.query(
      `INSERT INTO ${quoteIdent(table)} (${qCols}) VALUES ${valuesSql.join(", ")}`,
      params,
    );
    inserted += batch.length;
    batch = [];
  };

  for (const row of stmt.iterate() as Iterable<Record<string, unknown>>) {
    batch.push(colNames.map((name) => convertCell(row[name])));
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return { sqliteRows, inserted };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const dbPath = process.env.CRM_DB_PATH || "crm.db";
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (target Postgres). SQLite source is never deleted.");
  }

  // Migrator must not apply tenant RLS mid-copy.
  process.env.PG_RLS = "0";

  console.log(`[migrate] source SQLite: ${dbPath}`);
  console.log(`[migrate] target Postgres: (DATABASE_URL set, not printed)`);
  console.log(`[migrate] mode: ${args.dryRun ? "DRY-RUN" : args.force ? "FORCE WRITE" : "WRITE"}`);

  const sqlite = openSqliteReadonly(dbPath);
  const allTables = listSqliteTables(sqlite);
  const tables = orderedTables(allTables);
  console.log(`[migrate] SQLite tables: ${tables.length}`);

  // Dry-run can still print a full SQLite plan if Postgres is unreachable (e.g. host "db" only inside Docker).
  let pool: ReturnType<typeof openPgPool> | null = null;
  let client: PoolClient | null = null;
  try {
    pool = openPgPool(databaseUrl);
    client = await pool.connect();
    await client.query("SELECT 1");
  } catch (e) {
    if (!args.dryRun) {
      sqlite.close();
      if (client) client.release();
      if (pool) await pool.end();
      throw e;
    }
    console.warn(
      `[dry-run] WARN: cannot connect to Postgres (${e instanceof Error ? e.message : e}). ` +
        `Showing SQLite-only plan; no target checks.`,
    );
  }

  try {
    if (!client) {
      let totalSqlite = 0;
      for (const table of tables) {
        const cols = tableColumns(sqlite, table);
        const n = sqliteRowCount(sqlite, table);
        totalSqlite += n;
        console.log(`[dry-run] ${table}: ${n} rows, ${cols.length} cols`);
      }
      console.log(
        `[dry-run] OK (sqlite-only). Would copy ~${totalSqlite} rows across ${tables.length} tables. No changes written.`,
      );
      return;
    }

    await client.query("BEGIN");
    try {
      if (!args.dryRun) {
        await assertTargetSafe(client, args.force);
        if (args.force) await truncateAllPublic(client);
      } else if (await pgTableExists(client, "tenants")) {
        const n = await pgRowCount(client, "tenants");
        if (n > 0) {
          console.warn(
            `[dry-run] WARN: target already has ${n} tenants — real run needs --force or empty DB`,
          );
        }
      }

      const meta = await createSchemaFromSqlite(client, sqlite, tables, args.dryRun);

      let totalSqlite = 0;
      let totalInserted = 0;
      for (const table of tables) {
        const cols = meta.get(table);
        if (!cols) continue;
        const { sqliteRows, inserted } = await copyTable(client, sqlite, table, cols, args.dryRun);
        totalSqlite += sqliteRows;
        totalInserted += inserted;
        const mark = args.dryRun ? "planned" : `copied ${inserted}/${sqliteRows}`;
        console.log(`[migrate] ${table}: ${mark}`);
      }

      if (!args.dryRun) {
        for (const table of tables) {
          const cols = meta.get(table);
          if (!cols) continue;
          await ensureIdSequence(client, table, cols);
        }
        await client.query("COMMIT");
        console.log(`[migrate] DONE. Rows copied: ${totalInserted} (SQLite total scanned: ${totalSqlite})`);
        console.log(`[migrate] Next: npm run verify:postgres`);
        console.log(`[migrate] Then (owner only): psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql`);
      } else {
        await client.query("ROLLBACK");
        console.log(`[dry-run] OK. Would copy ~${totalSqlite} rows across ${tables.length} tables. No changes written.`);
      }
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  } finally {
    client?.release();
    if (pool) await pool.end();
    sqlite.close();
  }
}

main().catch((e) => {
  console.error("[migrate] FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
