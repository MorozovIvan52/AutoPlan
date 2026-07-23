/**
 * Verify SQLite vs Postgres after migrate-sqlite-to-postgres.ts
 *
 * Usage:
 *   npm run verify:postgres
 *   npx tsx scripts/verify-postgres-migration.ts
 *
 * Env: CRM_DB_PATH, DATABASE_URL
 * Exit 0 = match; exit 1 = mismatch / missing table.
 *
 * Does not write. Does not deploy.
 */
import "../load-env.ts";
import {
  BUSINESS_VERIFY_TABLES,
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
} from "./lib/sqlite-pg-migrate-utils.ts";

type Check = {
  table: string;
  sqliteRows: number;
  pgRows: number | null;
  ok: boolean;
  detail: string;
};

async function maxId(
  kind: "sqlite" | "pg",
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle: any,
  table: string,
  idCol: string,
): Promise<number | null> {
  if (kind === "sqlite") {
    const row = handle.prepare(
      `SELECT MAX(${quoteIdent(idCol)}) AS m FROM ${quoteIdent(table)}`,
    ).get() as { m: number | null };
    return row.m == null ? null : Number(row.m);
  }
  const res = await handle.query(
    `SELECT MAX(${quoteIdent(idCol)}) AS m FROM ${quoteIdent(table)}`,
  );
  const m = res.rows[0]?.m;
  return m == null ? null : Number(m);
}

async function tenantBreakdown(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sqlite: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  table: string,
): Promise<{ ok: boolean; detail: string }> {
  const cols = tableColumns(sqlite, table);
  if (!cols.some((c) => c.name === "tenant_id")) {
    return { ok: true, detail: "no tenant_id" };
  }
  const sqliteParts = sqlite
    .prepare(
      `SELECT tenant_id AS tid, COUNT(*) AS c FROM ${quoteIdent(table)} GROUP BY tenant_id ORDER BY tenant_id`,
    )
    .all() as { tid: number; c: number }[];
  const pgRes = await client.query(
    `SELECT tenant_id AS tid, COUNT(*)::bigint AS c
     FROM ${quoteIdent(table)} GROUP BY tenant_id ORDER BY tenant_id`,
  );
  const pgMap = new Map<number, number>(
    pgRes.rows.map((r: { tid: number; c: string | number }) => [Number(r.tid), Number(r.c)]),
  );
  const mismatches: string[] = [];
  for (const row of sqliteParts) {
    const pgC = pgMap.get(Number(row.tid)) ?? 0;
    if (pgC !== Number(row.c)) {
      mismatches.push(`tenant ${row.tid}: sqlite=${row.c} pg=${pgC}`);
    }
    pgMap.delete(Number(row.tid));
  }
  for (const [tid, c] of pgMap) {
    mismatches.push(`tenant ${tid}: sqlite=0 pg=${c}`);
  }
  if (mismatches.length) return { ok: false, detail: mismatches.join("; ") };
  return { ok: true, detail: `${sqliteParts.length} tenant bucket(s) match` };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("verify-postgres-migration.ts — compare row counts SQLite vs Postgres. Needs DATABASE_URL + CRM_DB_PATH.");
    return;
  }

  const dbPath = process.env.CRM_DB_PATH || "crm.db";
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  process.env.PG_RLS = "0";

  const sqlite = openSqliteReadonly(dbPath);
  const pool = openPgPool(databaseUrl);
  const client = await pool.connect();

  const checks: Check[] = [];
  let failed = 0;

  try {
    await client.query("SELECT 1");
    const tables = orderedTables(listSqliteTables(sqlite));
    console.log(`[verify] SQLite=${dbPath} tables=${tables.length}`);

    for (const table of tables) {
      const sqliteRows = sqliteRowCount(sqlite, table);
      const exists = await pgTableExists(client, table);
      if (!exists) {
        checks.push({
          table,
          sqliteRows,
          pgRows: null,
          ok: false,
          detail: "MISSING in Postgres",
        });
        failed++;
        continue;
      }
      const pgRows = await pgRowCount(client, table);
      const ok = sqliteRows === pgRows;
      if (!ok) failed++;
      checks.push({
        table,
        sqliteRows,
        pgRows,
        ok,
        detail: ok ? "count match" : `sqlite=${sqliteRows} pg=${pgRows}`,
      });
    }

    console.log("\n--- Row counts ---");
    for (const c of checks) {
      const mark = c.ok ? "OK" : "FAIL";
      console.log(`[${mark}] ${c.table}: ${c.detail} (sqlite=${c.sqliteRows})`);
    }

    console.log("\n--- Business tables: MAX(id) + per-tenant ---");
    for (const table of BUSINESS_VERIFY_TABLES) {
      if (!tables.includes(table)) continue;
      const cols = tableColumns(sqlite, table);
      const idCol = cols.find((c) => c.name === "id");
      if (idCol) {
        const sMax = await maxId("sqlite", sqlite, table, "id");
        const pMax = await maxId("pg", client, table, "id");
        const ok = sMax === pMax;
        if (!ok) failed++;
        console.log(
          `[${ok ? "OK" : "FAIL"}] ${table} MAX(id): sqlite=${sMax} pg=${pMax}`,
        );
      }
      const tb = await tenantBreakdown(sqlite, client, table);
      if (!tb.ok) failed++;
      console.log(`[${tb.ok ? "OK" : "FAIL"}] ${table} by tenant: ${tb.detail}`);
    }

    console.log(`\n[verify] ${failed === 0 ? "PASS" : "FAIL"} (${failed} problem(s))`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
    sqlite.close();
  }
}

main().catch((e) => {
  console.error("[verify] FAIL:", e instanceof Error ? e.message : e);
  process.exit(1);
});
