const IDENT_RE = /^[a-z_][a-z0-9_]*$/i;

/** Validate a SQL column/table identifier (defense-in-depth for dynamic DDL/UPDATE). */
export function assertSqlIdent(name: string): string {
  if (!IDENT_RE.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return name;
}

/** Build `col = ?` SET clauses from body keys mapped to whitelisted column names. */
export function buildSqlSetClauses(
  body: Record<string, unknown>,
  columnMap: Readonly<Record<string, string>>,
): { setClauses: string[]; values: unknown[] } {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  for (const [bodyKey, colName] of Object.entries(columnMap)) {
    if (body[bodyKey] === undefined) continue;
    const col = assertSqlIdent(colName);
    setClauses.push(`${col} = ?`);
    values.push(body[bodyKey]);
  }
  return { setClauses, values };
}
