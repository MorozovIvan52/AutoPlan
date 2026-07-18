import Database from "better-sqlite3";
import { drizzle as drizzleSqlite, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;

export function usePostgres(): boolean {
  if (process.env.CRM_FORCE_SQLITE === "1" || process.env.CRM_FORCE_SQLITE === "true") {
    return false;
  }
  return Boolean(process.env.DATABASE_URL?.trim());
}

let sqliteDb: Database.Database | null = null;
let pgPool: pg.Pool | null = null;

if (usePostgres()) {
  const connectionString = process.env.DATABASE_URL!
    .trim()
    .replace(/^postgresql\+asyncpg:/, "postgresql:");
  pgPool = new pg.Pool({
    connectionString,
    max: Number(process.env.PG_POOL_MAX || 20),
    idleTimeoutMillis: 30_000,
  });
  pgPool.on("error", (err) => {
    console.error("[pg] pool error:", err.message);
  });
} else {
  const dbPath = process.env.CRM_DB_PATH || "crm.db";
  sqliteDb = new Database(dbPath);
  sqliteDb.pragma("journal_mode = WAL");
}

/** Единый тип Drizzle (SQLite-схема); в режиме PostgreSQL — runtime-совместимый cast. */
export const db: AppDatabase = usePostgres()
  ? (drizzlePg(pgPool!, { schema }) as unknown as AppDatabase)
  : drizzleSqlite(sqliteDb!, { schema });

/** @deprecated Используйте raw-sql (sqlGet/sqlAll/sqlRun). Null в режиме PostgreSQL. */
export const sqlite: Database.Database = sqliteDb ?? (null as unknown as Database.Database);

export function getSqlite(): Database.Database | null {
  return sqliteDb;
}

export function getPgPool(): pg.Pool | null {
  return pgPool;
}

export async function closeDatabase(): Promise<void> {
  if (pgPool) await pgPool.end();
  if (sqliteDb) sqliteDb.close();
}
