/**
 * Ensure Postgres-only modules / SaaS tables after SQLite→PG migration.
 *
 * Why this exists:
 *   - Many ensure* bootstrap functions early-return on usePostgres()
 *   - drizzle-kit is SQLite dialect only
 *   - migrate script copies what was in SQLite; SaaS tables may be absent
 *
 * Usage:
 *   npm run pg:ensure-modules
 *
 * Requires DATABASE_URL. Does not modify SQLite. Does not deploy to VPS.
 */
import "../load-env.ts";
import { closeDatabase, usePostgres } from "../api/database/index.ts";
import { sqlExec, tableExists } from "../api/database/raw-sql.ts";
import { ensurePgExtensions } from "../api/lib/pg-extensions-bootstrap.ts";
import { ensureStripeWebhookEventsTable } from "../api/lib/stripe-webhook-events.ts";

async function ensureSaasTablesPg(): Promise<void> {
  // Mirror api/lib/saas-bootstrap.ts with BIGINT / app-compatible 0|1 flags.
  if (!(await tableExists("subscription_plans"))) {
    await sqlExec(`
      CREATE TABLE subscription_plans (
        id BIGSERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT NOT NULL,
        description TEXT,
        monthly_price_usd DOUBLE PRECISION NOT NULL,
        monthly_price_rub DOUBLE PRECISION NOT NULL,
        price_per_user_rub DOUBLE PRECISION NOT NULL DEFAULT 2500,
        max_users BIGINT NOT NULL,
        max_channels BIGINT NOT NULL,
        max_storage_gb BIGINT NOT NULL,
        max_conversations_per_month BIGINT,
        max_api_calls_per_day BIGINT,
        includes_custom_branding BIGINT DEFAULT 0,
        includes_api_access BIGINT DEFAULT 0,
        includes_advanced_reports BIGINT DEFAULT 0,
        includes_priority_support BIGINT DEFAULT 0,
        stripe_id TEXT,
        stripe_price_id TEXT,
        is_active BIGINT DEFAULT 1,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("tenant_subscriptions"))) {
    await sqlExec(`
      CREATE TABLE tenant_subscriptions (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        plan_id BIGINT NOT NULL REFERENCES subscription_plans(id),
        status TEXT NOT NULL DEFAULT 'trial',
        stripe_subscription_id TEXT,
        stripe_customer_id TEXT,
        stripe_payment_method_id TEXT,
        started_at BIGINT,
        trial_ends_at BIGINT,
        renews_at BIGINT,
        expires_at BIGINT,
        canceled_at BIGINT,
        billing_interval_months BIGINT DEFAULT 1,
        next_billing_date BIGINT,
        low_balance_notified_at BIGINT,
        expiration_warning_notified_at BIGINT,
        auto_renew BIGINT DEFAULT 1,
        created_at BIGINT,
        updated_at BIGINT
      )
    `);
    await sqlExec(
      "CREATE INDEX IF NOT EXISTS idx_tenant_subscriptions_tenant ON tenant_subscriptions(tenant_id)",
    );
  }

  if (!(await tableExists("invoices"))) {
    await sqlExec(`
      CREATE TABLE invoices (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        subscription_id BIGINT REFERENCES tenant_subscriptions(id),
        stripe_invoice_id TEXT UNIQUE,
        status TEXT NOT NULL DEFAULT 'draft',
        amount_usd DOUBLE PRECISION NOT NULL,
        amount_rub DOUBLE PRECISION NOT NULL,
        currency TEXT DEFAULT 'USD',
        description TEXT,
        invoice_number TEXT UNIQUE,
        issued_at BIGINT,
        due_at BIGINT,
        paid_at BIGINT,
        items TEXT,
        created_at BIGINT,
        updated_at BIGINT
      )
    `);
  }

  if (!(await tableExists("tenant_usage"))) {
    await sqlExec(`
      CREATE TABLE tenant_usage (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        active_users BIGINT DEFAULT 0,
        active_channels BIGINT DEFAULT 0,
        storage_used_gb DOUBLE PRECISION DEFAULT 0,
        conversations_this_month BIGINT DEFAULT 0,
        api_calls_today BIGINT DEFAULT 0,
        vin_decodes_used BIGINT DEFAULT 0,
        stock_skus_active BIGINT DEFAULT 0,
        call_minutes_used BIGINT DEFAULT 0,
        recorded_at BIGINT,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("audit_logs"))) {
    await sqlExec(`
      CREATE TABLE audit_logs (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        user_id BIGINT REFERENCES users(id),
        action TEXT NOT NULL,
        resource_type TEXT,
        resource_id TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        status TEXT DEFAULT 'success',
        error_message TEXT,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("support_tickets"))) {
    await sqlExec(`
      CREATE TABLE support_tickets (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        user_id BIGINT NOT NULL REFERENCES users(id),
        subject TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        priority TEXT DEFAULT 'medium',
        category TEXT,
        assigned_to BIGINT REFERENCES users(id),
        created_at BIGINT,
        updated_at BIGINT,
        resolved_at BIGINT
      )
    `);
  }

  if (!(await tableExists("ticket_replies"))) {
    await sqlExec(`
      CREATE TABLE ticket_replies (
        id BIGSERIAL PRIMARY KEY,
        ticket_id BIGINT NOT NULL REFERENCES support_tickets(id),
        user_id BIGINT NOT NULL REFERENCES users(id),
        message TEXT NOT NULL,
        is_internal BIGINT DEFAULT 0,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("api_keys"))) {
    await sqlExec(`
      CREATE TABLE api_keys (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        key_hash TEXT NOT NULL,
        key_prefix TEXT NOT NULL,
        scopes TEXT,
        last_used_at BIGINT,
        expires_at BIGINT,
        revoked_at BIGINT,
        ip_whitelist TEXT,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("tenant_webhooks"))) {
    await sqlExec(`
      CREATE TABLE tenant_webhooks (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id),
        name TEXT NOT NULL,
        url TEXT NOT NULL,
        secret TEXT NOT NULL,
        events TEXT,
        is_active BIGINT DEFAULT 1,
        last_triggered_at BIGINT,
        last_status_code BIGINT,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("webhook_logs"))) {
    await sqlExec(`
      CREATE TABLE webhook_logs (
        id BIGSERIAL PRIMARY KEY,
        webhook_id BIGINT NOT NULL REFERENCES tenant_webhooks(id),
        event_name TEXT NOT NULL,
        payload TEXT,
        status_code BIGINT,
        response_body TEXT,
        attempt BIGINT DEFAULT 1,
        max_attempts BIGINT DEFAULT 3,
        next_retry_at BIGINT,
        created_at BIGINT
      )
    `);
  }

  if (!(await tableExists("license_offer_otps"))) {
    await sqlExec(`
      CREATE TABLE license_offer_otps (
        id BIGSERIAL PRIMARY KEY,
        tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        phone TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts BIGINT DEFAULT 0,
        expires_at BIGINT NOT NULL,
        created_at BIGINT
      )
    `);
  }
}

async function main() {
  if (!process.env.DATABASE_URL?.trim()) {
    throw new Error("DATABASE_URL is required for pg:ensure-modules");
  }
  if (!usePostgres()) {
    throw new Error("CRM_FORCE_SQLITE is set — refuse to run Postgres ensure modules");
  }

  console.log("[pg:ensure-modules] ensuring extensions + SaaS tables…");
  await ensurePgExtensions();
  await ensureStripeWebhookEventsTable();
  await ensureSaasTablesPg();
  console.log("[pg:ensure-modules] OK");
}

main()
  .catch((e) => {
    console.error("[pg:ensure-modules] FAIL:", e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
