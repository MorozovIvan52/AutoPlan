#!/usr/bin/env bash
# Migration Helper: pre-flight без destructive действий
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "=== Migration Helper Pre-flight $(date -Iseconds) ==="
echo ""

bash scripts/agents/collect-context.sh /tmp/crm-migration-context.txt

echo "--- Checks ---"

if [[ -f crm.db ]]; then
  size=$(du -h crm.db | cut -f1)
  echo "OK: crm.db exists ($size)"
else
  echo "WARN: no crm.db in $ROOT"
fi

if [[ -n "${DATABASE_URL:-}" ]]; then
  echo "INFO: DATABASE_URL is set (Postgres mode)"
  if command -v psql >/dev/null 2>&1; then
    psql "$DATABASE_URL" -c "SELECT version();" 2>/dev/null | head -3 || echo "FAIL: cannot connect Postgres"
  fi
else
  echo "INFO: DATABASE_URL not set — SQLite mode"
fi

if [[ -f scripts/setup-postgres-rls.pgsql ]]; then
  echo "OK: scripts/setup-postgres-rls.pgsql present"
else
  echo "FAIL: missing RLS script"
fi

if [[ -f docs/ops/MIGRATE-TO-POSTGRES.md ]]; then
  echo "OK: MIGRATE-TO-POSTGRES.md present"
fi

echo ""
echo "--- Recommended order (DO NOT run without owner approval) ---"
cat <<'EOF'
1. cp crm.db /opt/backups/crm-$(date +%F).db
2. Install Postgres 15+, create DB user
3. export DATABASE_URL=postgresql://...
4. npm run db:push
5. psql "$DATABASE_URL" -f scripts/setup-postgres-rls.pgsql
6. export PG_RLS=1
7. npm run migrate:postgres   # if script exists
8. npm run verify:postgres
9. npm run pilot:seed:clean && npm run pilot:verify
Rollback: unset DATABASE_URL, pm2 restart crm
EOF

echo ""
echo "Paste this output to @crm-agent-migration in Cursor."
