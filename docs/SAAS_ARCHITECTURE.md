# 🏗️ SaaS Архитектура АвтоПлан CRM

## Обзор системы

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SAAS ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    FRONTEND (React)                          │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │ Admin Panel        User UI          Billing Dashboard  │ │  │
│  │  │ - Управление      - Диалоги        - Подписка        │ │  │
│  │  │ - Тарифы          - Клиенты        - История счётов  │ │  │
│  │  │ - Биллинг         - Каналы         - Лимиты          │ │  │
│  │  │ - Логи            - Интеграции     - Upgrade         │ │  │
│  │  └─────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  API BACKEND (Hono)                          │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │                                                               │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ Middleware                                             │  │  │
│  │  │ - resolveTenant (мультитенантность)                   │  │  │
│  │  │ - requireAuth (аутентификация)                         │  │  │
│  │  │ - requireAdmin (авторизация)                           │  │  │
│  │  │ - subscriptionCheck (проверка подписки)               │  │  │
│  │  │ - quotaEnforcement (проверка лимитов)                 │  │  │
│  │  │ - auditLog (логирование)                              │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                          ↓                                    │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ Routes Layer                                           │  │  │
│  │  │                                                        │  │  │
│  │  │ /auth              /tenants          /admin           │  │  │
│  │  │ - login           - register         - billing        │  │  │
│  │  │ - logout          - current          - clients        │  │  │
│  │  │ - signup          - adoption         - audit-log      │  │  │
│  │  │                                                        │  │  │
│  │  │ /users            /channels          /webhooks        │  │  │
│  │  │ - list            - list             - stripe         │  │  │
│  │  │ - create          - connect          - app            │  │  │
│  │  │ - update          - sync             - sanity         │  │  │
│  │  │ - delete          - disconnect                        │  │  │
│  │  │                                                        │  │  │
│  │  │ /clients          /conversations     /invoices        │  │  │
│  │  │ - list            - list             - get            │  │  │
│  │  │ - create          - open             - list           │  │  │
│  │  │ - update          - resolve          - download       │  │  │
│  │  │ - delete          - reopen                            │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                          ↓                                    │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ Business Logic Layer                                   │  │  │
│  │  │                                                        │  │  │
│  │  │ tenant.ts              billing.ts    quota.ts         │  │  │
│  │  │ - resolveTenant        - plans       - checkQuota     │  │  │
│  │  │ - provisionTenant      - subscribe   - canCreateUser  │  │  │
│  │  │ - subscriptionStatus   - invoice     - updateUsage    │  │  │
│  │  │                        - renewal                      │  │  │
│  │  │                                                        │  │  │
│  │  │ auth.ts                stripe.ts                      │  │  │
│  │  │ - validatePassword     - createCustomer              │  │  │
│  │  │ - createSession        - createSubscription          │  │  │
│  │  │ - checkPermissions     - handleWebhook               │  │  │
│  │  │                        - syncPlans                    │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 DATABASES & STORAGE                          │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │                                                               │  │
│  │  SQLite (better-sqlite3)                                      │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ Core Tables         │ Billing Tables                  │  │  │
│  │  │ - tenants           │ - subscription_plans            │  │  │
│  │  │ - users             │ - tenant_subscriptions          │  │  │
│  │  │ - sessions          │ - invoices                      │  │  │
│  │  │ - clients           │ - tenant_usage                  │  │  │
│  │  │ - conversations     │                                 │  │  │
│  │  │ - messages          │ Audit & Security                │  │  │
│  │  │ - channels          │ - audit_logs                    │  │  │
│  │  │ - tags              │ - api_keys                      │  │  │
│  │  │                     │ - webhooks                      │  │  │
│  │  │                     │ - webhook_logs                  │  │  │
│  │  │                     │ - support_tickets               │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  │                                                               │  │
│  │  File Storage                                                │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │ /opt/crm/uploads/   (видео, документы)                │  │  │
│  │  │ /opt/crm/backups/   (резервные копии)                 │  │  │
│  │  │ /opt/crm/logs/      (логи приложения)                 │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                              ↓                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │              EXTERNAL INTEGRATIONS                           │  │
│  ├──────────────────────────────────────────────────────────────┤  │
│  │                                                               │  │
│  │  Stripe (Payments)              Avito (Auto Sales)           │  │
│  │  - charge.succeeded             - webhook (leads)            │  │
│  │  - invoice.paid                 - api (messages)             │  │
│  │  - subscription.created         - sync (chats)               │  │
│  │  - payment_failed                                            │  │
│  │                                  Telegram, WhatsApp, SMS      │  │
│  │  AWS S3 / Yandex Cloud          - send messages              │  │
│  │  - store files                  - webhooks                   │  │
│  │  - CDN delivery                 - media                      │  │
│  │                                                               │  │
│  │  Email (SendGrid / SMTP)        Analytics (Yandex / GA)      │  │
│  │  - invoice notifications        - track events               │  │
│  │  - alert emails                 - usage reporting            │  │
│  │  - support replies              - retention metrics          │  │
│  │                                                               │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔐 Мультитенантность

### Изоляция данных

Каждый тенант изолирован на нескольких уровнях:

```typescript
// 1. На уровне middleware (resolveTenant)
// Автоматически определяет текущего тенанта из:
// - Поддомена (client1.example.com → tenantId=1)
// - Заголовка x-tenant-id
// - Заголовка x-tenant-slug
// - Текущего пользователя (user.tenantId)

// 2. На уровне запросов БД (forTenant, withTenant)
const users = await db
  .select()
  .from(schema.users)
  .where(forTenant(schema.users)) // Автоматически добавляет WHERE tenant_id = current_tenant
  .where(eq(schema.users.isActive, true));

// 3. На уровне приложения (tenantId() context)
const tid = tenantId(); // Всегда вернёт ID текущего тенанта
```

### Безопасность мультитенантности

✅ **Нельзя:** Видеть данные других тенантов  
✅ **Нельзя:** Обновлять данные других тенантов через cross-tenant запрос  
✅ **Нельзя:** Использовать API другого тенанта  
✅ **Нельзя:** Получить доступ к админ-панели другого тенанта  

---

## 💳 Система Биллинга

### Flow подписки новой компании

```
1. Компания регистрируется
   ↓
2. Создаётся тенант в БД
   - subscriptionStatus = "trial"
   - trialEndsAt = сегодня + 14 дней
   - subscriptionPlan = "start" (по умолчанию)
   - maxUsers = 3
   ↓
3. Администратор видит экран "Добавить платёжный метод"
   ↓
4. Система создаёт Stripe Customer
   ↓
5. Администратор вводит данные карты в Stripe форме
   ↓
6. Stripe создаёт PaymentMethod
   ↓
7. Мы создаём Subscription в Stripe
   - status = "active" (если карта прошла)
   - status = "past_due" (если карта отклонена)
   ↓
8. Stripe отправляет webhook "customer.subscription.created"
   ↓
9. Мы сохраняем stripeSubscriptionId в БД
   ↓
10. Приложение отправляет email с первым счётом
```

### Жизненный цикл подписки

```
Trial (14 дней)
├─ День 0: Компания регистрируется
├─ День 7: Email "Через неделю пробный период закончится"
├─ День 12: Блокируем создание новых записей, показываем CTA "Добавить карту"
└─ День 14: Доступ закрыт, данные видны (read-only)

Active (ежемесячно)
├─ День 1-28: Полный доступ
├─ День 25: Email "Счёт будет создан через 3 дня"
└─ День 28: Stripe отправляет invoice.created, мы отправляем email

Past Due (если платёж не прошёл)
├─ Попытка 1: Автоматический платёж через 3 дня
├─ Попытка 2: Автоматический платёж через 5 дней
├─ Попытка 3: Email "Обновите платёжный метод" + автоматический платёж через 7 дней
└─ Попытка 4 провалена: Доступ закрыт, нужно вручную обновить карту

Canceled (после отмены)
├─ День 1-28: Действующий период продолжается (они могут отменить отмену)
└─ День 28: Полное отключение
```

---

## ⚖️ Система Лимитов

### Лимиты по тарифам

| Лимит | Start | Business | Enterprise |
|-------|-------|----------|-----------|
| Пользователи | 3 | 25 | 100 |
| Каналы | 3 | 10 | 20 |
| Хранилище | 5 GB | 20 GB | 100 GB |
| Диалоги/месяц | 50 | 500 | 5000 |
| API вызовы/день | 100 | 1000 | 10000 |

### Enforcement (проверка лимитов)

```typescript
// При создании пользователя
if (!await canCreateUser(tenantId)) {
  return c.json({ error: "Лимит пользователей превышен" }, 403);
}

// При подключении канала
if (!await canCreateChannel(tenantId)) {
  return c.json({ error: "Лимит каналов превышен" }, 403);
}

// При загрузке файла
if (!await canUploadFile(tenantId, fileSizeGb)) {
  return c.json({ error: "Недостаточно хранилища" }, 413);
}

// В rate limiter для API
if (!canMakeApiCall(tenantId)) {
  return c.json({ error: "API rate limit exceeded" }, 429);
}
```

### Отображение лимитов в UI

```typescript
// На главной странице
<QuotaWarning /> // Компонент, показывает все лимиты

// В формах создания ресурсов
<QuotaPrecheck type="users" /> // Показывает предупреждение если лимит близко

// В админ-панели
<BillingPage /> // Детальный просмотр всех лимитов с нарастающей визуализацией
```

---

## 🔍 Аудит и Безопасность

### Audit Log

Все действия администраторов логируются:

```typescript
await db.insert(schema.auditLogs).values({
  tenantId,
  userId, // Кто сделал
  action: "subscription.plan_upgraded", // Что сделал
  resourceType: "subscription", // На чём
  resourceId: "123",
  details: JSON.stringify({
    oldPlanId: 1,
    newPlanId: 2,
    reason: "Admin initiated",
  }),
  ipAddress, // Откуда
  userAgent, // С какого браузера
  status: "success",
});
```

**Доступные логи:**
- `subscription.plan_changed` - смена тарифа
- `subscription.canceled` - отмена подписки
- `subscription.renewed` - продление
- `user.created` - создание пользователя
- `user.deleted` - удаление пользователя
- `user.role_changed` - смена роли
- `channel.connected` - подключение канала
- `channel.disconnected` - отключение канала
- `api_key.created` - создание API ключа
- `api_key.revoked` - отзыв API ключа
- `invoice.created` - выставление счёта
- `invoice.paid` - оплата счёта

### Защита Webhooks

Все webhooks подписаны и верифицируются:

```typescript
// ✅ Правильно
const event = stripe.webhooks.constructEvent(body, signature, secret);

// ❌ Неправильно
JSON.parse(body); // Риск MITM атаки
```

### Секреты клиента

Каждый клиент получает уникальные секреты для API:

```typescript
const apiKey = crypto.randomBytes(32).toString('hex');
const keyHash = hashPassword(apiKey); // Сохраняем хеш

await db.insert(schema.apiKeys).values({
  tenantId,
  name: "Mobile App",
  keyHash, // Сохраняем только хеш
  keyPrefix: apiKey.substring(0, 8), // Первые 8 символов для отображения
  scopes: ["read:users", "write:clients"],
});
```

---

## 📧 Уведомления и Эскалация

### Email Schedule

```
Trial Period:
- День 0: Welcome email + подтверждение регистрации
- День 7: "Через неделю закончится пробный период"
- День 11: Финальное напоминание
- День 14: "Пробный период закончился"

Активная подписка:
- День 1: Invoice #001
- День 5: "Счёт выставлен, спасибо за оплату"
- День 25: "Счёт будет выставлен через 3 дня"

Платёж провалился:
- День 1: "Платёж отклонен, пожалуйста обновите карту"
- День 4: Повтор попытки + email
- День 8: Финальное предупреждение
- День 9: Доступ закрыт

Использование лимитов:
- При 80% использования: Warning email
- При 100% использования: Critical alert + block
- При upgrade: Confirmation + new limits
```

### SMS Alerts (опционально)

```
При критических событиях (только для Enterprise):
- Платёж провалился
- Лимит диалогов исчерпан
- Хранилище заполнено
```

---

## 🔄 Асинхронные Задачи

### Cron Jobs (через PM2)

```bash
# Проверка истечения подписок (каждый день в 00:00 UTC)
npm run cron:check-subscriptions

# Отправка напоминаний о платежах (каждый день в 09:00 UTC)
npm run cron:send-payment-reminders

# Обновление счётчиков использования (каждый час)
npm run cron:update-usage

# Синхронизация со Stripe (каждые 30 минут)
npm run cron:sync-stripe-subscriptions

# Резервное копирование БД (каждый день в 03:00 UTC)
npm run cron:backup-database
```

### Event Queue (для обработки webhook'ов)

```typescript
// При получении webhook от Stripe
// Сохраняем в queue и обрабатываем асинхронно
await addToQueue({
  type: "stripe.webhook",
  payload: event,
  retryCount: 0,
  maxRetries: 3,
});
```

---

## 📊 Аналитика и Метрики

### Ключевые метрики для отслеживания

```typescript
interface MetricsSnapshot {
  // Revenue
  mrr: number; // Monthly Recurring Revenue
  arr: number; // Annual Recurring Revenue
  
  // Customers
  totalTenants: number;
  activeTenants: number;
  trialTenants: number;
  churnedTenants: number;
  
  // Usage
  totalUsers: number;
  totalChannels: number;
  totalConversations: number;
  totalStorage: number;
  
  // Health
  failedPayments: number;
  pastDueSubscriptions: number;
  supportTickets: number;
}
```

### Места для интеграции аналитики

- Mixpanel / Amplitude для tracking events
- Stripe Connect для финансовых данных
- Sentry для error tracking
- LogRocket для session replay

---

## 🚀 Deployment Checklist

### Перед запуском на production

- [ ] Все таблицы миграции применены
- [ ] Stripe API ключи установлены (Live mode)
- [ ] Webhook secret добавлена
- [ ] Email сервис настроен (SendGrid / SMTP)
- [ ] S3 / CDN для файлов
- [ ] SSL сертификат установлен
- [ ] Backups настроены
- [ ] Мониторинг настроен (Sentry, DataDog и т.д.)
- [ ] Rate limiting включен на API
- [ ] CORS правильно настроен
- [ ] Database индексы оптимизированы

---

## 📚 Файлы архитектуры

| Файл | Назначение |
|------|-----------|
| `api/lib/tenant.ts` | Логика тенантов и планов |
| `api/lib/stripe-integration.ts` | Интеграция со Stripe |
| `api/lib/quota-enforcement.ts` | Проверка лимитов |
| `api/routes/admin/billing.ts` | API управления подписками |
| `api/routes/admin/clients.ts` | API управления клиентами |
| `api/routes/webhooks/stripe.ts` | Webhook обработка |
| `api/middleware/tenant.ts` | Tenant resolution |
| `api/middleware/auth.ts` | Authentication |
| `src/pages/admin/BillingPage.tsx` | Admin UI для биллинга |
| `src/components/QuotaWarning.tsx` | Компонент предупреждений |

---

## 🔗 Дополнительные ссылки

- [BILLING_GUIDE.md](./BILLING_GUIDE.md) - Руководство для клиентов
- [STRIPE_SETUP.md](./STRIPE_SETUP.md) - Настройка Stripe
- [API Documentation](./API.md) - Документация API

---

*Последнее обновление: июль 2026*
