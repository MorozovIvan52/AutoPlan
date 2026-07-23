#!/usr/bin/env bash
# Собирает контекст для любого агента (VPS или локально)
set -euo pipefail

ROOT="${CRM_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$ROOT"

OUT="${1:-/tmp/crm-agent-context.txt}"
MANIFEST="scripts/pilot-demo-manifest.json"

{
  echo "=== CRM Agent Context $(date -Iseconds) ==="
  echo "ROOT=$ROOT"
  echo "NODE=$(node -v 2>/dev/null || echo n/a)"
  echo "PUBLIC_URL=${PUBLIC_URL:-not set}"
  echo "DATABASE_URL=${DATABASE_URL:+set}${DATABASE_URL:-not set}"
  echo "PG_RLS=${PG_RLS:-not set}"
  echo "TENANT_BASE=${TENANT_BASE_DOMAIN:-not set}"
  echo ""

  echo "=== Git ==="
  git rev-parse --short HEAD 2>/dev/null || echo "no git"
  git status -sb 2>/dev/null | head -5 || true
  echo ""

  echo "=== Pilot manifest ==="
  if [[ -f "$MANIFEST" ]]; then
    cat "$MANIFEST"
  else
    echo "MISSING: run npm run pilot:seed:clean"
  fi
  echo ""

  echo "=== Health ==="
  BASE="${CRM_BASE_URL:-http://127.0.0.1:4200}"
  curl -sS -m 5 "$BASE/api/health" 2>/dev/null || echo "CRM not reachable at $BASE"
  echo ""

  echo "=== PM2 (if VPS) ==="
  pm2 jlist 2>/dev/null | node -e "
    try {
      const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
      j.filter(p=>p.name==='crm').forEach(p=>console.log('crm', p.pm2_env?.status, 'uptime', p.pm2_env?.pm_uptime));
    } catch { console.log('pm2 n/a'); }
  " 2>/dev/null || echo "pm2 n/a"
  echo ""

  echo "=== Subdomains DNS ==="
  for h in sto1 sto2 sto3; do
    ip=$(getent hosts "${h}.crmavito.online" 2>/dev/null | awk '{print $1}' || true)
    echo "${h}.crmavito.online -> ${ip:-NOT_RESOLVED}"
  done
} > "$OUT"

echo "Context written: $OUT"
cat "$OUT"
