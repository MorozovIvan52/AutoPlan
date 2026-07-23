#!/usr/bin/env bash
set -euo pipefail
cd /opt/crm
mkdir -p /tmp/crm-agents
export PLAYWRIGHT_BASE_URL=https://crmavito.online
export PLAYWRIGHT_SKIP_WEBSERVER=1
export PILOT_AUDIT=1
export CRM_BASE_URL=https://crmavito.online
export CRM_AUDIT_REPORT=/tmp/crm-agents/full-audit-report.md
{
  echo "START=$(date -Iseconds)"
  echo "PWD=$(pwd)"
  # prefer npm script if present, else bash directly
  if npm run | grep -q 'agent:full-audit'; then
    npm run agent:full-audit
  else
    bash scripts/agents/run-full-audit.sh
  fi
  echo "EXIT=$?"
  echo "END=$(date -Iseconds)"
} > /tmp/crm-agents/audit.log 2>&1
