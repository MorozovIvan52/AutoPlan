#!/usr/bin/env bash
set -euo pipefail
cd /opt/crm
BASE=http://127.0.0.1:4200
CJ=/tmp/pilot-debug.cj
curl -sS -c "$CJ" -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -H "x-tenant-slug: sto-1" \
  -d '{"email":"master@sto1.demo","password":"PilotDemo2026!"}' | head -c 400
echo
curl -sS -b "$CJ" -H "x-tenant-slug: sto-1" "$BASE/api/deals?orderType=service" | head -c 2000
echo
sqlite3 crm.db "SELECT id, tenant_id, order_type, status, title FROM deals WHERE tenant_id=3;"
