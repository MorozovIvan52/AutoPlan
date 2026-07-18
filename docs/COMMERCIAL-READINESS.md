# Коммерческая готовность — пилот СТО (актуально)

Стек: **Vite + Hono + Drizzle**, prod: **PM2 + Nginx + SQLite** (PostgreSQL опционально).

## Закрыто для пилота

- HTTPS + HSTS, nginx, `crmavito.online`
- SSH hardening: `scripts/ops/harden-ssh.sh` (только ключи)
- `TRUST_PROXY=1`, убран `ALLOW_OFFER_OTP_WITHOUT_SMS`
- Публичные `/pricing`, `/legal/terms|privacy|sla`
- Оферта в продукте `/accept-offer` (требует `SMS_API_ID`)
- Stripe webhook с `constructEvent` (нужны ключи в `.env`)

## Обязательно вставить секреты (вручную)

```bash
# на VPS, не коммитить:
printf '%s\n' \
  'sk_live_ИЛИ_sk_test_...' \
  'whsec_...' \
  'price_start_...' \
  'price_business_...' \
  'price_enterprise_...' \
  'SMS_RU_API_ID_UUID' \
  'pk_live_...' \
| bash /opt/crm/scripts/ops/apply-pilot-secrets.sh
```

Затем в Stripe Dashboard webhook:
`https://crmavito.online/api/webhooks/stripe`
события: `invoice.paid`, `invoice.payment_succeeded`, `invoice.payment_failed`, `customer.subscription.*`

Smoke: `BASE_URL=https://crmavito.online npx tsx scripts/ops/stripe-webhook-smoke.ts`
