#!/bin/bash
set -euo pipefail
COOKIE=/tmp/crm-ai-cookie.txt
rm -f "$COOKIE"
BASE=https://sto1.crmavito.online
PASS='PilotDemo2026!'

echo "=== login ==="
curl -sS -m 20 -c "$COOKIE" -b "$COOKIE" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"admin@sto1.demo\",\"password\":\"$PASS\"}" \
  "$BASE/api/auth/login" | head -c 400
echo
echo "=== cookie ==="
cat "$COOKIE"
echo
echo "=== me ==="
curl -sS -m 20 -c "$COOKIE" -b "$COOKIE" "$BASE/api/auth/me" | head -c 300
echo
echo "=== ai/status ==="
curl -sS -m 60 -c "$COOKIE" -b "$COOKIE" "$BASE/api/ai/status"
echo
echo "=== ai/scan ==="
curl -sS -m 180 -c "$COOKIE" -b "$COOKIE" \
  -H "Content-Type: application/json" -X POST "$BASE/api/ai/scan"
echo
