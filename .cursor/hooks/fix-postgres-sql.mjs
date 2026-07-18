#!/usr/bin/env node
/**
 * Cursor hook: убирает ложные MSSQL-ошибки для PostgreSQL-скриптов.
 * - Переименовывает scripts/*.sql с PL/pgSQL в *.pgsql
 * - Удаляет дубликат setup-postgres-rls.sql, если есть канонический .pgsql
 */
import fs from "node:fs";
import path from "node:path";

const PG_MARKERS = [
  /CREATE\s+OR\s+REPLACE\s+FUNCTION/i,
  /\bDO\s+\$\$/i,
  /\bFOREACH\b/i,
  /::\s*INTEGER/i,
  /ROW\s+LEVEL\s+SECURITY/i,
  /current_setting\s*\(/i,
];

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function isPostgresSql(content) {
  return PG_MARKERS.some((re) => re.test(content));
}

function fixStraySetupSql(root) {
  const legacy = path.join(root, "scripts", "setup-postgres-rls.sql");
  const canonical = path.join(root, "scripts", "setup-postgres-rls.pgsql");
  if (!fs.existsSync(legacy) || !fs.existsSync(canonical)) return null;

  const legacyText = fs.readFileSync(legacy, "utf8");
  if (isPostgresSql(legacyText)) {
    fs.unlinkSync(legacy);
    return "removed duplicate scripts/setup-postgres-rls.sql (use .pgsql)";
  }
  return null;
}

function maybeRenameSqlToPgsql(root, relPath) {
  if (!relPath.endsWith(".sql")) return null;
  const normalized = relPath.replace(/\\/g, "/");
  if (!normalized.startsWith("scripts/")) return null;
  if (normalized === "scripts/setup-postgres-rls.sql") return null;

  const abs = path.join(root, relPath);
  if (!fs.existsSync(abs)) return null;

  const content = fs.readFileSync(abs, "utf8");
  if (!isPostgresSql(content)) return null;

  const targetRel = relPath.replace(/\.sql$/i, ".pgsql");
  const targetAbs = path.join(root, targetRel);
  if (fs.existsSync(targetAbs)) {
    fs.unlinkSync(abs);
    return `removed ${relPath} (already have ${targetRel})`;
  }

  fs.renameSync(abs, targetAbs);
  return `renamed ${relPath} → ${targetRel}`;
}

function main() {
  const root = process.cwd();
  const actions = [];

  const stray = fixStraySetupSql(root);
  if (stray) actions.push(stray);

  const raw = readStdin().trim();
  if (raw) {
    try {
      const payload = JSON.parse(raw);
      const filePath = payload.file_path || payload.path || payload.filePath;
      if (typeof filePath === "string") {
        const rel = path.relative(root, path.resolve(root, filePath));
        const renamed = maybeRenameSqlToPgsql(root, rel);
        if (renamed) actions.push(renamed);
      }
    } catch {
      // ignore malformed hook payload
    }
  }

  if (actions.length) {
    process.stdout.write(JSON.stringify({
      additional_context: `[fix-postgres-sql] ${actions.join("; ")}. PostgreSQL-скрипты только в *.pgsql — иначе MSSQL-линтер IDE даёт ложные ошибки.`,
    }));
  }
}

main();
