import { sql } from "drizzle-orm";
import { db } from "../database";
import type { AppDatabase } from "../database";
import { getTenantId } from "./tenant-context";
import { usePostgres } from "../database/raw-sql";

export type DbExecutor = AppDatabase;

/** Drizzle transaction with optional Postgres RLS tenant GUC. */
export async function withTenantTransaction<T>(
  fn: (tx: DbExecutor) => Promise<T>,
): Promise<T> {
  if (usePostgres() && process.env.PG_RLS !== "0") {
    type PgTx = { execute: (q: ReturnType<typeof sql>) => Promise<unknown> };
    const pgDb = db as unknown as { transaction: (fn: (tx: PgTx) => Promise<T>) => Promise<T> };
    return pgDb.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.tenant_id', ${String(getTenantId())}, true)`);
      return fn(tx as unknown as DbExecutor);
    });
  }
  return db.transaction(async (tx) => fn(tx as DbExecutor));
}
