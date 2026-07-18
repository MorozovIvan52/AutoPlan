import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { sqlGet, sqlExec, tableExists, tableColumns, usePostgres } from "../database/raw-sql";

const DEFAULT_PLANS = [
  {
    name: "start",
    displayName: "Старт",
    description: "Для небольших команд",
    monthlyPriceUsd: 9.99,
    monthlyPriceRub: 899,
    pricePerUserRub: 899,
    maxUsers: 3,
    maxChannels: 3,
    maxStorageGb: 5,
    maxConversationsPerMonth: 500,
    maxApiCallsPerDay: 1000,
  },
  {
    name: "business",
    displayName: "Бизнес",
    description: "Для растущих автосервисов",
    monthlyPriceUsd: 49,
    monthlyPriceRub: 1356,
    pricePerUserRub: 1356,
    maxUsers: 25,
    maxChannels: 10,
    maxStorageGb: 20,
    maxConversationsPerMonth: 5000,
    maxApiCallsPerDay: 10000,
    includesAdvancedReports: true,
  },
  {
    name: "enterprise",
    displayName: "Энтерпрайз",
    description: "Для сетей и крупных компаний",
    monthlyPriceUsd: 199,
    monthlyPriceRub: 1356,
    pricePerUserRub: 1356,
    maxUsers: 100,
    maxChannels: 20,
    maxStorageGb: 100,
    includesCustomBranding: true,
    includesApiAccess: true,
    includesAdvancedReports: true,
    includesPrioritySupport: true,
  },
] as const;

export async function ensureSaasTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      monthly_price_usd REAL NOT NULL,
      monthly_price_rub REAL NOT NULL,
      price_per_user_rub REAL NOT NULL DEFAULT 2500,
      max_users INTEGER NOT NULL,
      max_channels INTEGER NOT NULL,
      max_storage_gb INTEGER NOT NULL,
      max_conversations_per_month INTEGER,
      max_api_calls_per_day INTEGER,
      includes_custom_branding INTEGER DEFAULT 0,
      includes_api_access INTEGER DEFAULT 0,
      includes_advanced_reports INTEGER DEFAULT 0,
      includes_priority_support INTEGER DEFAULT 0,
      stripe_id TEXT,
      stripe_price_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tenant_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id),
      status TEXT NOT NULL DEFAULT 'trial',
      stripe_subscription_id TEXT,
      stripe_customer_id TEXT,
      stripe_payment_method_id TEXT,
      started_at INTEGER,
      trial_ends_at INTEGER,
      renews_at INTEGER,
      expires_at INTEGER,
      canceled_at INTEGER,
      billing_interval_months INTEGER DEFAULT 1,
      next_billing_date INTEGER,
      low_balance_notified_at INTEGER,
      expiration_warning_notified_at INTEGER,
      auto_renew INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id);
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      subscription_id INTEGER REFERENCES tenant_subscriptions(id),
      stripe_invoice_id TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'draft',
      amount_usd REAL NOT NULL,
      amount_rub REAL NOT NULL,
      currency TEXT DEFAULT 'USD',
      description TEXT,
      invoice_number TEXT UNIQUE,
      issued_at INTEGER,
      due_at INTEGER,
      paid_at INTEGER,
      items TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tenant_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      active_users INTEGER DEFAULT 0,
      active_channels INTEGER DEFAULT 0,
      storage_used_gb REAL DEFAULT 0,
      conversations_this_month INTEGER DEFAULT 0,
      api_calls_today INTEGER DEFAULT 0,
      vin_decodes_used INTEGER DEFAULT 0,
      stock_skus_active INTEGER DEFAULT 0,
      call_minutes_used INTEGER DEFAULT 0,
      recorded_at INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      user_id INTEGER REFERENCES users(id),
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      status TEXT DEFAULT 'success',
      error_message TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS support_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      subject TEXT NOT NULL,
      description TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      priority TEXT DEFAULT 'medium',
      category TEXT,
      assigned_to INTEGER REFERENCES users(id),
      created_at INTEGER,
      updated_at INTEGER,
      resolved_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS ticket_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id),
      user_id INTEGER NOT NULL REFERENCES users(id),
      message TEXT NOT NULL,
      is_internal INTEGER DEFAULT 0,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      scopes TEXT,
      last_used_at INTEGER,
      expires_at INTEGER,
      revoked_at INTEGER,
      ip_whitelist TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS tenant_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT NOT NULL,
      events TEXT,
      is_active INTEGER DEFAULT 1,
      last_triggered_at INTEGER,
      last_status_code INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS webhook_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      webhook_id INTEGER NOT NULL REFERENCES tenant_webhooks(id),
      event_name TEXT NOT NULL,
      payload TEXT,
      status_code INTEGER,
      response_body TEXT,
      attempt INTEGER DEFAULT 1,
      max_attempts INTEGER DEFAULT 3,
      next_retry_at INTEGER,
      created_at INTEGER
    );
  `);

  if (await tableExists("tenant_usage")) {
    const cols = await tableColumns("tenant_usage");
    const names = new Set(cols.map((c) => c.name));
    for (const [name, ddl] of [
      ["vin_decodes_used", "vin_decodes_used INTEGER DEFAULT 0"],
      ["stock_skus_active", "stock_skus_active INTEGER DEFAULT 0"],
      ["call_minutes_used", "call_minutes_used INTEGER DEFAULT 0"],
    ] as const) {
      if (!names.has(name)) {
        await sqlExec(`ALTER TABLE tenant_usage ADD COLUMN ${ddl}`);
      }
    }
  }
}

export async function seedSubscriptionPlans() {
  if (!(await tableExists("subscription_plans"))) return;

  const count = await sqlGet<{ n: number }>("SELECT COUNT(*) AS n FROM subscription_plans");
  if ((count?.n ?? 0) > 0) return;

  for (const plan of DEFAULT_PLANS) {
    await db.insert(schema.subscriptionPlans).values({
      name: plan.name,
      displayName: plan.displayName,
      description: plan.description,
      monthlyPriceUsd: plan.monthlyPriceUsd,
      monthlyPriceRub: plan.monthlyPriceRub,
      pricePerUserRub: plan.pricePerUserRub,
      maxUsers: plan.maxUsers,
      maxChannels: plan.maxChannels,
      maxStorageGb: plan.maxStorageGb,
      maxConversationsPerMonth: "maxConversationsPerMonth" in plan ? plan.maxConversationsPerMonth : null,
      maxApiCallsPerDay: "maxApiCallsPerDay" in plan ? plan.maxApiCallsPerDay : null,
      includesCustomBranding: "includesCustomBranding" in plan ? plan.includesCustomBranding : false,
      includesApiAccess: "includesApiAccess" in plan ? plan.includesApiAccess : false,
      includesAdvancedReports: "includesAdvancedReports" in plan ? plan.includesAdvancedReports : false,
      includesPrioritySupport: "includesPrioritySupport" in plan ? plan.includesPrioritySupport : false,
      stripePriceId: process.env[`STRIPE_PRICE_${plan.name.toUpperCase()}`]?.trim() || null,
      isActive: true,
    });
  }
}

export async function ensureTenantSubscription(tenantId: number, planName = "business") {
  if (!(await tableExists("tenant_subscriptions"))) return;

  const existing = await db
    .select()
    .from(schema.tenantSubscriptions)
    .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
    .limit(1);
  if (existing.length) return existing[0];

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (!tenant) return null;

  const planKey = (tenant.subscriptionPlan || planName).toLowerCase();
  const [plan] = await db
    .select()
    .from(schema.subscriptionPlans)
    .where(eq(schema.subscriptionPlans.name, planKey))
    .limit(1);
  if (!plan) return null;

  const now = new Date();
  const trialEnds = tenant.trialEndsAt ?? new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  const status = tenant.subscriptionStatus === "active" ? "active" : "trial";

  const [sub] = await db.insert(schema.tenantSubscriptions).values({
    tenantId,
    planId: plan.id,
    status: status as "active" | "trial",
    trialEndsAt: status === "trial" ? trialEnds : null,
    startedAt: now,
    renewsAt: status === "active" ? new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) : null,
    autoRenew: true,
    createdAt: now,
    updatedAt: now,
  }).returning();

  const usageExisting = await db
    .select()
    .from(schema.tenantUsage)
    .where(eq(schema.tenantUsage.tenantId, tenantId))
    .limit(1);
  if (!usageExisting.length) {
    await db.insert(schema.tenantUsage).values({ tenantId, recordedAt: now });
  }

  return sub;
}

export async function ensureAllSaasBootstrap(): Promise<{ plans: number; subscriptions: number }> {
  await ensureSaasTables();
  await seedSubscriptionPlans();

  const planCount = await sqlGet<{ n: number }>("SELECT COUNT(*) AS n FROM subscription_plans");
  const tenants = await db.select({ id: schema.tenants.id }).from(schema.tenants);
  let subs = 0;
  for (const t of tenants) {
    const sub = await ensureTenantSubscription(t.id);
    if (sub) subs++;
  }
  return { plans: planCount?.n ?? 0, subscriptions: subs };
}

export async function getPlanIdByName(planName: string): Promise<number | null> {
  const [plan] = await db
    .select({ id: schema.subscriptionPlans.id })
    .from(schema.subscriptionPlans)
    .where(eq(schema.subscriptionPlans.name, planName))
    .limit(1);
  return plan?.id ?? null;
}
