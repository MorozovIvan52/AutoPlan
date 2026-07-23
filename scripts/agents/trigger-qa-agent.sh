#!/usr/bin/env bash
# QA Agent: полный прогон для VPS/локально → отчёт для вставки в Cursor
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CTX="/tmp/crm-qa-context-$$.txt"
REPORT="/tmp/crm-qa-report-$$.txt"
BASE="${CRM_BASE_URL:-http://127.0.0.1:4200}"
export CRM_BASE_URL="$BASE"

bash scripts/agents/collect-context.sh "$CTX"

{
  echo "=== QA AGENT REPORT $(date -Iseconds) ==="
  echo "CRM_BASE_URL=$BASE"
  echo ""

  echo "--- 1. pilot:verify ---"
  if bash scripts/pilot-demo-verify.sh; then
    echo "RESULT: pilot:verify PASS"
  else
    echo "RESULT: pilot:verify FAIL (exit $?)"
  fi
  echo ""

  echo "--- 2. typecheck ---"
  if npx tsc --noEmit 2>&1; then
    echo "RESULT: typecheck PASS"
  else
    echo "RESULT: typecheck FAIL"
  fi
  echo ""

  echo "--- 3. unit tests ---"
  if npm run test:unit 2>&1 | tail -20; then
    echo "RESULT: unit PASS"
  else
    echo "RESULT: unit FAIL (see above)"
  fi
  echo ""

  echo "--- Context snapshot ---"
  cat "$CTX"
} | tee "$REPORT"

echo ""
echo "=== Copy to Cursor QA Agent (@crm-agent-qa) ==="
echo "Report file: $REPORT"
