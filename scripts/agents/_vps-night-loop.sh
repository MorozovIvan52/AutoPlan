#!/usr/bin/env bash
# Night CRM agents loop on VPS — every 2 hours
set -uo pipefail
cd /opt/crm
mkdir -p /tmp/crm-agents

# Ensure tooling
if [ ! -x node_modules/.bin/tsc ]; then
  npm install -D typescript --no-fund --no-audit || true
fi
if [ ! -d node_modules/@playwright/test ]; then
  npm install -D @playwright/test --no-fund --no-audit || true
  npx playwright install chromium || true
fi

export PLAYWRIGHT_BASE_URL=https://crmavito.online
export PLAYWRIGHT_SKIP_WEBSERVER=1
export PILOT_AUDIT=1
export CRM_BASE_URL=https://crmavito.online
export CRM_AUDIT_REPORT=/tmp/crm-agents/full-audit-report.md

while true; do
  echo "CYCLE_START $(date -Iseconds)" | tee -a /tmp/crm-agents/night.log
  bash scripts/agents/run-full-audit.sh >> /tmp/crm-agents/night.log 2>&1 || true
  echo "CYCLE_END $(date -Iseconds)" | tee -a /tmp/crm-agents/night.log
  npm run agent:migration-check >> /tmp/crm-agents/migration-night.log 2>&1 || true
  npm run agent:qa >> /tmp/crm-agents/qa-night.log 2>&1 || true
  sleep 7200
done
