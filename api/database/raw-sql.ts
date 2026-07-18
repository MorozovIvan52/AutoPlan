import type Database from "better-sqlite3";
import type pg from "pg";
import { getPgPool, getSqlite, usePostgres } from "./index";
import { getTenantId } from "../lib/tenant-context";

export { usePostgres };

function pgRlsEnabled(): boolean {
  return usePostgres() && process.env.PG_RLS !== "0";
}

function toPgSql(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

function ensureInsertReturning(sql: string): string {
  const t = sql.trim();
  if (/^INSERT/i.test(t) && !/RETURNING/i.test(t)) {
    return t.replace(/;?\s*$/, "") + " RETURNING id";
  }
  return sql;
}

async function setPgTenantLocal(client: pg.PoolClient): Promise<void> {
  await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [String(getTenantId())]);
}

/** Run query on a dedicated client inside BEGIN/COMMIT with tenant GUC (Postgres RLS). */
async function pgWithTenant<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getPgPool()!;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (pgRlsEnabled()) await setPgTenantLocal(client);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function sqlGet<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  if (usePostgres()) {
    if (pgRlsEnabled()) {
      const r = await pgWithTenant((client) => client.query(toPgSql(sql), params));
      return r.rows[0] as T | undefined;
    }
    const r = await getPgPool()!.query(toPgSql(sql), params);
    return r.rows[0] as T | undefined;
  }
  return getSqlite()!.prepare(sql).get(...params) as T | undefined;
}

export async function sqlAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  if (usePostgres()) {
    if (pgRlsEnabled()) {
      const r = await pgWithTenant((client) => client.query(toPgSql(sql), params));
      return r.rows as T[];
    }
    const r = await getPgPool()!.query(toPgSql(sql), params);
    return r.rows as T[];
  }
  return getSqlite()!.prepare(sql).all(...params) as T[];
}

export async function sqlRun(
  sql: string,
  ...params: unknown[]
): Promise<{ changes: number; lastInsertRowid: number | bigint }> {
  if (usePostgres()) {
    const q = ensureInsertReturning(sql);
    if (pgRlsEnabled()) {
      const r = await pgWithTenant((client) => client.query(toPgSql(q), params));
      const id = (r.rows[0] as { id?: number } | undefined)?.id ?? 0;
      return { changes: r.rowCount ?? 0, lastInsertRowid: id };
    }
    const r = await getPgPool()!.query(toPgSql(q), params);
    const id = (r.rows[0] as { id?: number } | undefined)?.id ?? 0;
    return { changes: r.rowCount ?? 0, lastInsertRowid: id };
  }
  const r = getSqlite()!.prepare(sql).run(...params);
  return { changes: r.changes, lastInsertRowid: r.lastInsertRowid as number | bigint };
}

export async function sqlExec(statement: string): Promise<void> {
  if (usePostgres()) {
    if (pgRlsEnabled()) {
      await pgWithTenant((client) => client.query(statement));
      return;
    }
    await getPgPool()!.query(statement);
    return;
  }
  getSqlite()!.exec(statement);
}

/** Health-check: SELECT 1 */
export async function sqlPing(): Promise<boolean> {
  try {
    await sqlGet("SELECT 1 AS ok");
    return true;
  } catch {
    return false;
  }
}

/** PRAGMA table_info — SQLite only; PG uses information_schema */
export async function tableColumns(table: string): Promise<{ name: string }[]> {
  if (usePostgres()) {
    const rows = await sqlAll<{ name: string }>(
      `SELECT column_name AS name FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? ORDER BY ordinal_position`,
      table,
    );
    return rows;
  }
  return getSqlite()!.pragma(`table_info(${table})`) as { name: string }[];
}

export async function tableExists(table: string): Promise<boolean> {
  if (usePostgres()) {
    const row = await sqlGet<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`,
      table,
    );
    return (row?.n ?? 0) > 0;
  }
  const row = getSqlite()!
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table);
  return Boolean(row);
}
