#!/usr/bin/env bash
set -euo pipefail
cd /opt/crm
sqlite3 crm.db < scripts/pilot-fix-offer.sql
CRM_BASE_URL=http://127.0.0.1:4200 bash scripts/pilot-demo-verify.sh
