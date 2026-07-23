#!/usr/bin/env bash
set -euo pipefail
cd /opt/crm
echo "=== nginx subdomain health ==="
curl -sS -o /dev/null -w "sto1 via nginx: %{http_code}\n" -H "Host: sto1.crmavito.online" https://127.0.0.1/api/health -k
curl -sS -o /dev/null -w "sto2 via nginx: %{http_code}\n" -H "Host: sto2.crmavito.online" https://127.0.0.1/api/health -k
echo "=== login via Host sto1 ==="
curl -sS -c /tmp/sub.cj -X POST http://127.0.0.1:4200/api/auth/login \
  -H "Content-Type: application/json" \
  -H "Host: sto1.crmavito.online" \
  -d '{"email":"master@sto1.demo","password":"PilotDemo2026!"}' | head -c 250
echo
echo "=== deals sto-1 ==="
curl -sS -b /tmp/sub.cj -H "Host: sto1.crmavito.online" "http://127.0.0.1:4200/api/deals?orderType=service" | head -c 200
echo
echo "=== public DNS check (may fail until Beget A records) ==="
for h in sto1 sto2 sto3; do
  ip=$(getent hosts ${h}.crmavito.online 2>/dev/null | awk '{print $1}' || true)
  echo "${h}.crmavito.online -> ${ip:-NOT_RESOLVED}"
done
