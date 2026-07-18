# 🔗 Интеграция Stripe для SaaS

## Быстрый старт (10 минут)

### Шаг 1: Создать аккаунт Stripe

1. Откройте https://stripe.com
2. Нажмите **Sign up** (регистрируйтесь как **Business**)
3. Заполните:
   - Business name: Ваша компания
   - Business type: Software as a Service
   - Country: Ваша страна
4. Подтвердите email
5. Пройдите KYC (загрузите документы компании)

**Время ожидания:** 5-30 минут (иногда до 24 часов)

### Шаг 2: Получить API ключи

1. Откройте Stripe Dashboard: https://dashboard.stripe.com
2. Слева → **Developers** → **API keys**
3. Вы видите две пары ключей:
   - **Test mode** (для разработки) 🟡
   - **Live mode** (для боевого сервера) 🔴

**Для разработки используйте Test mode:**
```bash
STRIPE_PUBLIC_KEY=pk_test_xxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxx
```

**Для production используйте Live mode:**
```bash
STRIPE_PUBLIC_KEY=pk_live_xxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
```

### Шаг 3: Добавить ключи в .env

На вашем сервере отредактируйте `/opt/crm/.env`:

```bash
# Stripe
STRIPE_PUBLIC_KEY=pk_live_xxxxxxxxxxxx
STRIPE_SECRET_KEY=sk_live_xxxxxxxxxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx
```

### Шаг 4: Создать Products и Prices в Stripe

Запустите скрипт синхронизации тарифов:

```bash
cd /opt/crm
npm run stripe:sync-plans
```

**Что происходит:**
- Система создаёт 3 продукта в Stripe: Start, Business, Enterprise
- Для каждого создаётся цена (monthly recurring)
- Сохраняются `stripe_id` и `stripe_price_id` в БД

**Проверка:** Откройте https://dashboard.stripe.com → **Products** → вы должны увидеть 3 продукта.

### Шаг 5: Настроить Webhook

Webhooks позволяют Stripe уведомлять ваше приложение о событиях (платежи, отмена подписки и т.д.)

**На боевом сервере:**

1. Откройте https://dashboard.stripe.com → **Developers** → **Webhooks**
2. Нажмите **Add an endpoint**
3. Заполните:
   - **Endpoint URL:** `https://your-domain.com/webhooks/stripe`
   - **Events to send:** Выберите все события (или выберите вручную)
4. Нажмите **Add endpoint**
5. Вы получите **Signing secret** (начинается с `whsec_`)
6. Добавьте в `.env`: `STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxx`
7. Перезагрузите приложение: `pm2 restart crm`

**Проверка webhook:**
```bash
curl -X POST https://your-domain.com/webhooks/stripe \
  -H "Content-Type: application/json" \
  -d '{"type": "ping"}'
```

---

## 📝 Тестирование (Development Mode)

### Тестовые карты Stripe

Используйте эти номера карт в режиме Test:

| Сценарий | Номер карты | Срок | CVC |
|----------|-----------|------|-----|
| ✅ Успешный платёж | `4242 4242 4242 4242` | `12/25` | `123` |
| ❌ Отклонённый платёж | `4000 0000 0000 0002` | `12/25` | `123` |
| ⚠️ 3D Secure | `4000 0025 0000 3155` | `12/25` | `123` |
| 💳 Требует карту | `4000 0000 0000 9995` | `12/25` | `123` |

### Симуляция событий

Используйте Stripe CLI для тестирования webhooks:

```bash
# Установить Stripe CLI
brew install stripe/stripe-cli/stripe  # macOS
# или скачайте отсюда: https://stripe.com/docs/stripe-cli

# Авторизоваться
stripe login

# Триггерить событие платежа
stripe trigger payment_intent.succeeded

# Триггерить создание подписки
stripe trigger customer.subscription.created

# Запустить forwards из Stripe Dashboard в локальное приложение
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

## 🚀 Production Setup

### Checklist перед запуском

- [ ] API ключи заменены на Live mode в `.env`
- [ ] Webhook secret добавлена и проверена
- [ ] Все 3 тарифа (Products) созданы в Stripe
- [ ] Приложение перезагружено (`pm2 restart crm`)
- [ ] Тестовый платёж произведён и счёт создался в БД
- [ ] Email с счётом отправился клиенту

### Мониторинг платежей

1. Откройте Stripe Dashboard → **Payments**
2. Вы должны видеть все платежи в real-time
3. Для каждого платежа можно увидеть:
   - Сумму и статус
   - Клиента и email
   - Дату и время
   - Метод оплаты

### Логирование ошибок

Все ошибки Stripe логируются в:
```bash
tail -f /opt/crm/logs/stripe-errors.log
```

Если платёж провалился:
```bash
grep "invoice.payment_failed" /opt/crm/logs/stripe-webhooks.log
```

---

## 🔐 Безопасность

### PCI Compliance

✅ **Ваше приложение НЕ хранит и НЕ видит номера карт** — это делает Stripe

✅ **Все данные платежа зашифрованы** TLS 1.2+

✅ **Stripe сертифицирована** по PCI DSS Level 1

### Защита Webhook

Все webhooks подписаны Stripe. Проверяйте подпись:

```typescript
// ✅ Правильно (в коде уже реализовано)
const event = stripe.webhooks.constructEvent(body, signature, webhookSecret);

// ❌ Неправильно - пропускать проверку подписи НЕЛЬЗЯ!
const event = JSON.parse(body);
```

### API Key Security

- 🔴 **НИКОГДА** не коммитьте Secret Key в Git
- 🔴 **НИКОГДА** не показывайте Secret Key в логах
- 🟢 Secret Key только в `.env` (в `_prod`)
- 🟢 Public Key можно использовать в frontend коде

---

## 📊 Аналитика платежей

### Основные метрики

```sql
-- Чистый доход за месяц
SELECT 
  SUM(amount_usd) as revenue,
  COUNT(DISTINCT tenant_id) as customers
FROM invoices
WHERE status = 'paid'
  AND strftime('%Y-%m', datetime(issued_at/1000, 'unixepoch')) = '2026-07';

-- Retention rate
SELECT 
  COUNT(DISTINCT CASE WHEN status = 'active' THEN tenant_id END) / 
  COUNT(DISTINCT tenant_id) * 100 as retention_rate
FROM tenant_subscriptions;

-- Churn rate
SELECT 
  COUNT(DISTINCT CASE WHEN status = 'canceled' THEN tenant_id END) / 
  COUNT(DISTINCT tenant_id) * 100 as churn_rate
FROM tenant_subscriptions
WHERE canceled_at >= datetime('now', '-1 month');
```

### Запросы Stripe API

```bash
# Все платежи за месяц
curl -s https://api.stripe.com/v1/charges \
  -u sk_live_xxxx: \
  -G -d limit=100 \
  -d created[gte]=$(date -d "1 month ago" +%s) \
  | jq '.data[] | {id, amount, status}'

# Активные подписки
curl -s https://api.stripe.com/v1/subscriptions \
  -u sk_live_xxxx: \
  -G -d limit=100 \
  -d status=active \
  | jq '.data[] | {id, customer, current_period_end}'
```

---

## 🛠️ Troubleshooting

### Проблема: "Invalid API Key"

**Решение:** Проверьте:
1. Вы используете ключ от правильного аккаунта (Test vs Live)
2. Ключ скопирован полностью (без пробелов)
3. Перезагрузили приложение после изменения `.env`

```bash
# Проверить ключ
echo $STRIPE_SECRET_KEY
# Должно вывести: sk_live_... или sk_test_...
```

---

### Проблема: Webhook не работает

**Решение:**
1. Проверьте URL endpoint: `https://domain.com/webhooks/stripe` (без `/api`)
2. Проверьте брандмауэр разрешает входящие POST запросы на порт 443
3. Используйте Stripe CLI для локального тестирования:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

### Проблема: Платёж не создал счёт в БД

**Решение:**
1. Проверьте логи: `pm2 logs crm | grep webhook`
2. Проверьте, что webhook secret правильная в `.env`
3. Вручную триггерьте webhook через CLI:

```bash
stripe trigger payment_intent.succeeded
```

---

## 💡 Примеры использования

### Создать подписку для тенанта

```typescript
import { createStripeSubscription } from "../lib/stripe-integration";

await createStripeSubscription({
  tenantId: 123,
  stripeCustomerId: "cus_xxxxx",
  stripePriceId: "price_xxxxx",
  billingIntervalMonths: 1,
});
```

### Обновить тариф

```typescript
import { updateStripeSubscription } from "../lib/stripe-integration";

await updateStripeSubscription(
  "sub_xxxxx", // Stripe subscription ID
  "price_xxxxx" // Новый price ID
);
```

### Получить информацию о подписке

```typescript
const subscription = await stripe.subscriptions.retrieve("sub_xxxxx");

console.log({
  status: subscription.status,
  currentPeriodEnd: new Date(subscription.current_period_end * 1000),
  items: subscription.items.data,
});
```

---

## 📚 Ссылки

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Webhook Events](https://stripe.com/docs/api/events)
- [Testing Cards](https://stripe.com/docs/testing)
- [Stripe CLI](https://stripe.com/docs/stripe-cli)

---

*Последнее обновление: июль 2026*
