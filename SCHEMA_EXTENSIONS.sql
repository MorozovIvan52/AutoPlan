/**
 * ═══════════════════════════════════════════════════════════════════
 * Расширение schema.ts: Billing, Audit Logs, Usage Tracking
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Добавьте эти таблицы в конец файла api/database/schema.ts
 */

// ── Subscriptions & Billing ────────────────────────────────────────
export const subscriptionPlans = sqliteTable("subscription_plans", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // "start", "business", "enterprise"
  displayName: text("display_name").notNull(), // "Старт", "Бизнес", "Энтерпрайз"
  description: text("description"),
  monthlyPriceUsd: real("monthly_price_usd").notNull(),
  monthlyPriceRub: real("monthly_price_rub").notNull(),
  // Цена за одного пользователя в рублях (если тариф помесячно за юзера)
  pricePerUserRub: real("price_per_user_rub").notNull().default(2500),
  
  // Limits
  maxUsers: integer("max_users").notNull(),
  maxChannels: integer("max_channels").notNull(),
  maxStorageGb: integer("max_storage_gb").notNull(),
  maxConversationsPerMonth: integer("max_conversations_per_month"),
  maxApiCallsPerDay: integer("max_api_calls_per_day"),
  
  // Features
  includesCustomBranding: integer("includes_custom_branding", { mode: "boolean" }).default(false),
  includesApiAccess: integer("includes_api_access", { mode: "boolean" }).default(false),
  includesAdvancedReports: integer("includes_advanced_reports", { mode: "boolean" }).default(false),
  includesPrioritySupport: integer("includes_priority_support", { mode: "boolean" }).default(false),
  
  // Stripe
  stripeId: text("stripe_id"),
  stripePriceId: text("stripe_price_id"),
  
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const tenantSubscriptions = sqliteTable("tenant_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  planId: integer("plan_id").notNull().references(() => subscriptionPlans.id),
  
  status: text("status", {
    enum: ["active", "trial", "past_due", "canceled", "expired"],
  }).notNull().default("trial"),
  
  // Stripe info
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeCustomerId: text("stripe_customer_id"),
  stripePaymentMethodId: text("stripe_payment_method_id"),
  
  // Dates
  startedAt: integer("started_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  trialEndsAt: integer("trial_ends_at", { mode: "timestamp" }),
  renewsAt: integer("renews_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  canceledAt: integer("canceled_at", { mode: "timestamp" }),
  
  // Payment
  billingIntervalMonths: integer("billing_interval_months").default(1), // 1, 3, 12
  nextBillingDate: integer("next_billing_date", { mode: "timestamp" }),
  
  // Notifications
  lowBalanceNotifiedAt: integer("low_balance_notified_at", { mode: "timestamp" }),
  expirationWarningNotifiedAt: integer("expiration_warning_notified_at", { mode: "timestamp" }),
  
  autoRenew: integer("auto_renew", { mode: "boolean" }).default(true),
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  subscriptionId: integer("subscription_id").references(() => tenantSubscriptions.id),
  
  stripeInvoiceId: text("stripe_invoice_id").unique(),
  
  status: text("status", {
    enum: ["draft", "open", "paid", "void", "uncollectible"],
  }).notNull().default("draft"),
  
  amountUsd: real("amount_usd").notNull(),
  amountRub: real("amount_rub").notNull(),
  currency: text("currency").default("USD"),
  
  description: text("description"),
  invoiceNumber: text("invoice_number").unique(),
  
  issuedAt: integer("issued_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  dueAt: integer("due_at", { mode: "timestamp" }),
  paidAt: integer("paid_at", { mode: "timestamp" }),
  
  items: text("items"), // JSON: [{ description, quantity, unitPrice, amount }]
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Usage Tracking ─────────────────────────────────────────────────
export const tenantUsage = sqliteTable("tenant_usage", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  
  // Current counts
  activeUsers: integer("active_users").default(0),
  activeChannels: integer("active_channels").default(0),
  storageUsedGb: real("storage_used_gb").default(0),
  conversationsThisMonth: integer("conversations_this_month").default(0),
  apiCallsToday: integer("api_calls_today").default(0),
  
  // Tracking
  recordedAt: integer("recorded_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Audit Logs (действия админов) ──────────────────────────────────
export const auditLogs = sqliteTable("audit_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  userId: integer("user_id").references(() => users.id),
  
  action: text("action").notNull(), // "subscription.plan_changed", "user.created", "api_key.revoked", etc.
  
  resourceType: text("resource_type"), // "tenant", "user", "subscription", "channel", etc.
  resourceId: text("resource_id"),
  
  details: text("details"), // JSON: { oldValue, newValue, reason, etc. }
  
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  
  status: text("status", { enum: ["success", "failure"] }).default("success"),
  errorMessage: text("error_message"),
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Support Tickets (для техподдержки) ─────────────────────────────
export const supportTickets = sqliteTable("support_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  userId: integer("user_id").notNull().references(() => users.id),
  
  subject: text("subject").notNull(),
  description: text("description").notNull(),
  
  status: text("status", {
    enum: ["open", "in_progress", "resolved", "closed"],
  }).notNull().default("open"),
  
  priority: text("priority", {
    enum: ["low", "medium", "high", "critical"],
  }).default("medium"),
  
  category: text("category"), // "billing", "technical", "feature_request", "other"
  
  assignedTo: integer("assigned_to").references(() => users.id),
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  resolvedAt: integer("resolved_at", { mode: "timestamp" }),
});

export const ticketReplies = sqliteTable("ticket_replies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  ticketId: integer("ticket_id").notNull().references(() => supportTickets.id),
  userId: integer("user_id").notNull().references(() => users.id),
  
  message: text("message").notNull(),
  isInternal: integer("is_internal", { mode: "boolean" }).default(false), // видимо только для поддержки
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── API Keys (для интеграций) ──────────────────────────────────────
export const apiKeys = sqliteTable("api_keys", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  
  name: text("name").notNull(), // "Мобильное приложение", "Боты", etc.
  keyHash: text("key_hash").notNull(),
  keyPrefix: text("key_prefix").notNull(), // первые 8 символов для отображения
  
  scopes: text("scopes"), // JSON: ["read:users", "write:clients", "read:deals"]
  
  lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  revokedAt: integer("revoked_at", { mode: "timestamp" }),
  
  ipWhitelist: text("ip_whitelist"), // JSON: ["192.168.1.1", "10.0.0.0/8"]
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

// ── Webhooks (для уведомлений) ─────────────────────────────────────
export const webhooks = sqliteTable("webhooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tenantId: integer("tenant_id").notNull().references(() => tenants.id),
  
  name: text("name").notNull(),
  url: text("url").notNull(),
  secret: text("secret").notNull(), // для подписи
  
  events: text("events"), // JSON: ["subscription.changed", "user.created", "invoice.paid"]
  
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  
  lastTriggeredAt: integer("last_triggered_at", { mode: "timestamp" }),
  lastStatusCode: integer("last_status_code"),
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const webhookLogs = sqliteTable("webhook_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  webhookId: integer("webhook_id").notNull().references(() => webhooks.id),
  
  eventName: text("event_name").notNull(),
  payload: text("payload"), // JSON
  
  statusCode: integer("status_code"),
  responseBody: text("response_body"),
  
  attempt: integer("attempt").default(1),
  maxAttempts: integer("max_attempts").default(3),
  nextRetryAt: integer("next_retry_at", { mode: "timestamp" }),
  
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});
