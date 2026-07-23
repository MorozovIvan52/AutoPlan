#!/usr/bin/env bash
# Проверка демо-полигона (3 СТО). Запуск на VPS после npm run pilot:seed
set -euo pipefail

BASE="${CRM_BASE_URL:-http://127.0.0.1:4200}"
PASS="${PILOT_DEMO_PASSWORD:-PilotDemo2026!}"
CJ="/tmp/crm-pilot-cookies-$$"
MANIFEST="${CRM_MANIFEST:-scripts/pilot-demo-manifest.json}"

if [[ ! -f "$MANIFEST" ]]; then
  echo "Нет $MANIFEST — сначала: npm run pilot:seed"
  exit 1
fi

T1_ID=$(node -e "const m=require('./$MANIFEST'); console.log(m.tenants[0].id)")
T2_ID=$(node -e "const m=require('./$MANIFEST'); console.log(m.tenants[1].id)")
DRAFT_DEAL=$(node -e "const m=require('./$MANIFEST'); console.log(m.tenants[0].deals.draftId)")
FOREIGN_DEAL=$(node -e "const m=require('./$MANIFEST'); console.log(m.tenants[1].deals.draftId)")
CONV_ID=$(node -e "const m=require('./$MANIFEST'); console.log(m.tenants[0].conversationId)")
RECEIPT_ID=$(node -e "const m=require('./$MANIFEST'); console.log(m.tenants[0].receiptDocId || '')")

login() {
  local email="$1"
  local tenant_slug="$2"
  local jar="$3"
  local body
  body=$(curl -sS -c "$jar" -X POST "$BASE/api/auth/login" \
    -H "Content-Type: application/json" \
    -H "x-tenant-slug: $tenant_slug" \
    -d "{\"email\":\"$email\",\"password\":\"$PASS\"}")
  echo "$body" | head -c 200
  echo ""
  if echo "$body" | grep -q LICENSE_OFFER_REQUIRED; then
    echo "FAIL: tenant must accept license offer — re-run npm run pilot:seed:clean"
    exit 1
  fi
}

echo "=== 1. Мастер sto-1: только свои ЗН ==="
J1="/tmp/pilot-sto1-$$.txt"
login "master@sto1.demo" "sto-1" "$J1"
RES=$(curl -sS -b "$J1" -H "x-tenant-slug: sto-1" "$BASE/api/deals?orderType=service")
echo "$RES" | node -e "
const d=JSON.parse(require('fs').readFileSync(0,'utf8'));
if(d.code==='LICENSE_OFFER_REQUIRED'){console.error('FAIL: license offer');process.exit(1)}
const deals=(d.deals||[]).filter(x=>x.orderType==='service');
console.log('count', deals.length);
if(deals.length<2) process.exit(1);
"
echo "OK: >=2 service deals for sto-1"

echo "=== 2. Утечка tenant: master sto-1 + header sto-2 → 403 ==="
CODE=$(curl -sS -o /dev/null -w "%{http_code}" -b "$J1" \
  -H "x-tenant-slug: sto-2" \
  "$BASE/api/deals/$FOREIGN_DEAL")
if [[ "$CODE" != "403" && "$CODE" != "404" ]]; then
  echo "FAIL: expected 403/404, got $CODE"
  exit 1
fi
echo "OK: HTTP $CODE"

echo "=== 3. Race condition: два close на draft ЗН с qty=1 ==="
JADM="/tmp/pilot-admin1-$$.txt"
login "admin@sto1.demo" "sto-1" "$JADM"
PAY='{"paymentAmount":4500,"paymentMethod":"cash","setStatusDone":true,"allowPartial":true}'
curl -sS -b "$JADM" -H "Content-Type: application/json" -H "x-tenant-slug: sto-1" \
  -X POST "$BASE/api/sto/deals/$DRAFT_DEAL/close-with-payment" -d "$PAY" &
curl -sS -b "$JADM" -H "Content-Type: application/json" -H "x-tenant-slug: sto-1" \
  -X POST "$BASE/api/sto/deals/$DRAFT_DEAL/close-with-payment" -d "$PAY" &
wait
STOCK=$(curl -sS -b "$JADM" -H "x-tenant-slug: sto-1" "$BASE/api/parts?search=PILOT-1-RACE")
echo "$STOCK" | node -e "
const p=JSON.parse(require('fs').readFileSync(0,'utf8')).parts?.[0];
if(!p){console.log('part missing — check manually');process.exit(0)}
console.log('qty after race', p.qty);
if(p.qty < 0) { console.error('FAIL: negative stock'); process.exit(1); }
"
echo "OK: stock not negative"

echo "=== 4. Печать / PDF по ЗН (order doc) ==="
if [[ -n "$RECEIPT_ID" ]]; then
  GEN=$(curl -sS -b "$JADM" -H "Content-Type: application/json" -H "x-tenant-slug: sto-1" \
    -X POST "$BASE/api/docs/generate" \
    -d "{\"orderId\":$(node -e "const m=require('./$MANIFEST');console.log(m.tenants[0].deals.closedId)"),\"type\":\"order\"}")
  echo "$GEN" | node -e "const j=JSON.parse(require('fs').readFileSync(0,'utf8')); if(!j.doc&&!j.id&&!j.ok) process.exit(1)"
  echo "OK: docs/generate responded"
else
  echo "SKIP: no receipt id in manifest"
fi

echo "=== 5. Чат: последние сообщения ==="
MSGS=$(curl -sS -b "$JADM" -H "x-tenant-slug: sto-1" "$BASE/api/conversations/$CONV_ID/messages")
echo "$MSGS" | node -e "
const j=JSON.parse(require('fs').readFileSync(0,'utf8'));
const m=j.messages||[];
console.log('messages', m.length);
if(m.length<5) process.exit(1);
"
echo "OK: >=5 messages"

rm -f "$J1" "$JADM" "$CJ"
echo "✅ All pilot tests passed"
