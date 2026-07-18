import { sqlExec, usePostgres } from "../database/raw-sql";
import { log } from "./logger";

const COMPOSITE_UNIQUES: { table: string; index: string; columns: string[]; dropConstraints?: string[] }[] = [
  {
    table: "users",
    index: "users_tenant_email_unique",
    columns: ["tenant_id", "email"],
    dropConstraints: ["users_email_key", "users_email_unique"],
  },
  {
    table: "channels",
    index: "channels_tenant_slug_unique",
    columns: ["tenant_id", "slug"],
    dropConstraints: ["channels_slug_key", "channels_slug_unique"],
  },
  {
    table: "payroll_roles",
    index: "payroll_roles_tenant_slug_unique",
    columns: ["tenant_id", "slug"],
    dropConstraints: ["payroll_roles_slug_key", "payroll_roles_slug_unique"],
  },
];

/** SaaS: один email/slug на организацию, не глобально. */
export async function ensureSaasCompositeUniques() {
  for (const spec of COMPOSITE_UNIQUES) {
    const cols = spec.columns.join(", ");
    const idxSql = `CREATE UNIQUE INDEX IF NOT EXISTS ${spec.index} ON ${spec.table}(${cols})`;
    try {
      await sqlExec(idxSql);
    } catch (e) {
      log.warn({ index: spec.index, err: e instanceof Error ? e.message : String(e) }, "composite unique index");
    }

    if (usePostgres() && spec.dropConstraints) {
      for (const c of spec.dropConstraints) {
        try {
          await sqlExec(`ALTER TABLE ${spec.table} DROP CONSTRAINT IF EXISTS ${c}`);
        } catch { /* ignore */ }
      }
    }
  }

  if (!usePostgres()) {
    log.info({}, "SQLite: composite unique indexes ensured; remove legacy UNIQUE(email) via drizzle-kit push on fresh DB");
  }
}
