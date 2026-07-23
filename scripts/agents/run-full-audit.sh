#!/usr/bin/env bash
# Полный аудит CRM: curl + Playwright (все страницы, API, ЗН, чат)
# Полный доступ ТОЛЬКО к demo tenant sto-1/2/3 — не трогает prod клиентов
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

REPORT="${CRM_AUDIT_REPORT:-/tmp/crm-full-audit-report.md}"
BASE="${CRM_BASE_URL:-http://127.0.0.1:4200}"
PW_BASE="${PLAYWRIGHT_BASE_URL:-$BASE}"
PILOT_SLUG="${PILOT_TENANT_SLUG:-sto-1}"
PILOT_LOGIN="${PILOT_LOGIN:-admin@sto1.demo}"
PILOT_PASS="${PILOT_DEMO_PASSWORD:-PilotDemo2026!}"

PASS=0
FAIL=0
log() { echo "$1" | tee -a "$REPORT"; }

: > "$REPORT"
log "# CRM Full Audit Report"
log ""
log "- Time: $(date -Iseconds)"
log "- API: $BASE"
log "- Playwright: $PW_BASE"
log "- Pilot tenant: $PILOT_SLUG ($PILOT_LOGIN)"
log ""

run_step() {
  local name="$1"
  shift
  log "## $name"
  if "$@" >> "$REPORT" 2>&1; then
    log "✅ PASS: $name"
    PASS=$((PASS + 1))
  else
    log "❌ FAIL: $name (exit $?)"
    FAIL=$((FAIL + 1))
  fi
  log ""
}

log "## Context"
bash scripts/agents/collect-context.sh /tmp/crm-audit-ctx.txt >> "$REPORT" 2>&1 || true
cat /tmp/crm-audit-ctx.txt >> "$REPORT" 2>/dev/null || true
log ""

run_step "pilot:verify (API smoke)" \
  env CRM_BASE_URL="$BASE" bash scripts/pilot-demo-verify.sh

run_step "typecheck" \
  npm run typecheck

run_step "unit tests" \
  npm run test:unit

if [[ ! -d node_modules/@playwright/test ]]; then
  log "⚠ Playwright missing — installing @playwright/test + chromium"
  npm install -D @playwright/test --no-fund --no-audit >>"$REPORT" 2>&1 || true
  npx playwright install chromium >>"$REPORT" 2>&1 || true
fi

if [[ -d node_modules/@playwright/test ]]; then
  SKIP_WS=""
  if [[ "$PW_BASE" != "http://127.0.0.1:4200" && "$PW_BASE" != "http://localhost:4200" ]]; then
    SKIP_WS="PLAYWRIGHT_SKIP_WEBSERVER=1"
  fi
  run_step "Playwright full-crm-audit (UI + API + ЗН)" \
    env $SKIP_WS \
        PLAYWRIGHT_BASE_URL="$PW_BASE" \
        PILOT_AUDIT=1 \
        PILOT_TENANT_SLUG="$PILOT_SLUG" \
        PILOT_LOGIN="$PILOT_LOGIN" \
        PILOT_PASSWORD="$PILOT_PASS" \
        npx playwright test e2e/full-crm-audit.spec.ts --project=chromium
else
  log "⚠ SKIP Playwright: install failed"
fi

log "---"
log "## Summary"
log "- PASS: $PASS"
log "- FAIL: $FAIL"
log ""

if [[ "$FAIL" -eq 0 ]]; then
  log "✅ **FULL CRM AUDIT PASSED**"
  echo ""
  echo "Report: $REPORT"
  exit 0
else
  log "❌ **FULL CRM AUDIT FAILED** — передай отчёт @crm-agent-qa → @crm-agent-code-fixer"
  echo ""
  echo "Report: $REPORT"
  exit 1
fi
