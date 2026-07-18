/**
 * api/lib/stripe-integration.ts — интеграция с Stripe для биллинга
 */

import type Stripe from "stripe";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { getStripe, requireStripe } from "./stripe-client";
import { notifyBillingEvent } from "./mail";
import { alertBillingIssue } from "./sentry";

async function getTenantAdminEmail(tenantId: number): Promise<{ email: string; name: string } | null> {
  const [row] = await db
    .select({ email: schema.users.email, name: schema.tenants.name })
    .from(schema.users)
    .innerJoin(schema.tenants, eq(schema.users.tenantId, schema.tenants.id))
    .where(eq(schema.users.tenantId, tenantId))
    .limit(1);
  if (!row?.email) return null;
  return { email: row.email, name: row.name };
}

export async function createStripeCustomer(tenantId: number, email: string, name: string) {
  const stripe = requireStripe();
  try {
    return await stripe.customers.create({
      email,
      name,
      metadata: { tenantId: String(tenantId) },
    });
  } catch (e) {
    console.error("Stripe customer creation failed:", e);
    throw e;
  }
}

export async function updateStripePaymentMethod(stripeCustomerId: string, paymentMethodId: string) {
  const stripe = requireStripe();
  try {
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });
  } catch (e) {
    console.error("Stripe payment method update failed:", e);
    throw e;
  }
}

export async function createStripeSubscription(opts: {
  tenantId: number;
  stripeCustomerId: string;
  stripePriceId: string;
  billingIntervalMonths?: number;
  quantity?: number;
}) {
  const stripe = requireStripe();
  try {
    let quantity = opts.quantity;
    if (typeof quantity === "undefined") {
      const rows = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.tenantId, opts.tenantId));
      quantity = rows.length || 1;
    }

    const subscription = await stripe.subscriptions.create({
      customer: opts.stripeCustomerId,
      items: [{ price: opts.stripePriceId, quantity }],
      billing_cycle_anchor: Math.floor(Date.now() / 1000),
      metadata: { tenantId: String(opts.tenantId) },
    });

    const now = new Date();
    const renewsAt = new Date(Date.now() + (opts.billingIntervalMonths ?? 1) * 30 * 24 * 60 * 60 * 1000);

    await db
      .update(schema.tenantSubscriptions)
      .set({
        stripeSubscriptionId: subscription.id,
        stripeCustomerId: opts.stripeCustomerId,
        status: "active",
        renewsAt,
        nextBillingDate: renewsAt,
        updatedAt: now,
      })
      .where(eq(schema.tenantSubscriptions.tenantId, opts.tenantId));

    return subscription;
  } catch (e) {
    console.error("Stripe subscription creation failed:", e);
    throw e;
  }
}

export async function updateStripeSubscription(stripeSubscriptionId: string, stripePriceId: string) {
  const stripe = requireStripe();
  try {
    const subscription = await stripe.subscriptions.retrieve(stripeSubscriptionId);
    if (!subscription.items.data.length) throw new Error("No subscription items found");

    return await stripe.subscriptions.update(stripeSubscriptionId, {
      items: [{ id: subscription.items.data[0]!.id, price: stripePriceId }],
      proration_behavior: "always_invoice",
    });
  } catch (e) {
    console.error("Stripe subscription update failed:", e);
    throw e;
  }
}

export async function cancelStripeSubscription(stripeSubscriptionId: string) {
  const stripe = requireStripe();
  try {
    return await stripe.subscriptions.cancel(stripeSubscriptionId);
  } catch (e) {
    console.error("Stripe subscription cancellation failed:", e);
    throw e;
  }
}

export async function handleStripeWebhook(event: Stripe.Event) {
  // Логирование + idempotency — в routes/webhooks/stripe.ts
  const now = new Date();

  switch (event.type) {
    case "invoice.paid":
    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenantId = Number(invoice.metadata?.tenantId);

      if (!tenantId) break;

      await db.insert(schema.invoices).values({
        tenantId,
        stripeInvoiceId: invoice.id,
        status: "paid",
        amountUsd: invoice.amount_paid / 100,
        amountRub: (invoice.amount_paid / 100) * (Number(process.env.USD_TO_RUB) || 100),
        currency: invoice.currency?.toUpperCase() || "USD",
        paidAt: invoice.status_transitions?.paid_at
          ? new Date(invoice.status_transitions.paid_at * 1000)
          : now,
        issuedAt: new Date(invoice.created * 1000),
        description: `Invoice ${invoice.number}`,
        invoiceNumber: invoice.number || undefined,
      });

      await db
        .update(schema.tenantSubscriptions)
        .set({ status: "active", updatedAt: now })
        .where(eq(schema.tenantSubscriptions.stripeSubscriptionId, String(invoice.subscription)));

      await db
        .update(schema.tenants)
        .set({ subscriptionStatus: "active" })
        .where(eq(schema.tenants.id, tenantId));

      const admin = await getTenantAdminEmail(tenantId);
      if (admin) {
        void notifyBillingEvent({
          to: admin.email,
          tenantName: admin.name,
          event: "renewal",
        });
      }
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const tenantId = Number(invoice.metadata?.tenantId);

      await db
        .update(schema.tenantSubscriptions)
        .set({ status: "past_due", updatedAt: now })
        .where(eq(schema.tenantSubscriptions.stripeSubscriptionId, String(invoice.subscription)));

      if (tenantId) {
        const admin = await getTenantAdminEmail(tenantId);
        if (admin) {
          void notifyBillingEvent({
            to: admin.email,
            tenantName: admin.name,
            event: "payment_failed",
          });
        }
        alertBillingIssue({ event: "payment_failed", tenantId, details: invoice.id });
      }
      break;
    }

    case "customer.subscription.created": {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantId = Number(subscription.metadata?.tenantId);
      if (!tenantId) break;

      const renewsAt = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null;

      await db
        .update(schema.tenantSubscriptions)
        .set({
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: String(subscription.customer),
          status: mapStripeSubscriptionStatus(subscription.status),
          renewsAt,
          nextBillingDate: renewsAt,
          updatedAt: now,
        })
        .where(eq(schema.tenantSubscriptions.tenantId, tenantId));

      await db
        .update(schema.tenants)
        .set({
          subscriptionStatus: subscription.status === "trialing" ? "trial" : "active",
        })
        .where(eq(schema.tenants.id, tenantId));
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantId = Number(subscription.metadata?.tenantId);

      await db
        .update(schema.tenantSubscriptions)
        .set({ status: "canceled", canceledAt: now, updatedAt: now })
        .where(eq(schema.tenantSubscriptions.stripeSubscriptionId, subscription.id));

      if (tenantId) {
        await db
          .update(schema.tenants)
          .set({ subscriptionStatus: "expired" })
          .where(eq(schema.tenants.id, tenantId));
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const tenantId = Number(subscription.metadata?.tenantId);
      const renewsAt = subscription.current_period_end
        ? new Date(subscription.current_period_end * 1000)
        : null;

      await db
        .update(schema.tenantSubscriptions)
        .set({
          status: mapStripeSubscriptionStatus(subscription.status),
          renewsAt,
          nextBillingDate: renewsAt,
          updatedAt: now,
        })
        .where(eq(schema.tenantSubscriptions.stripeSubscriptionId, subscription.id));

      if (tenantId) {
        const tenantStatus =
          subscription.status === "trialing" ? "trial"
          : subscription.status === "active" ? "active"
          : subscription.status === "canceled" ? "expired"
          : "expired";
        await db
          .update(schema.tenants)
          .set({ subscriptionStatus: tenantStatus })
          .where(eq(schema.tenants.id, tenantId));
      }
      break;
    }
  }
}

function mapStripeSubscriptionStatus(
  status: Stripe.Subscription.Status,
): "active" | "trial" | "past_due" | "canceled" | "expired" {
  switch (status) {
    case "trialing": return "trial";
    case "active": return "active";
    case "past_due": return "past_due";
    case "canceled": return "canceled";
    case "unpaid":
    case "incomplete":
    case "incomplete_expired":
    case "paused":
      return "expired";
    default:
      return "expired";
  }
}

export async function getStripePriceForPlan(planName: string): Promise<string | null> {
  const stripe = getStripe();
  if (!stripe) return process.env[`STRIPE_PRICE_${planName.toUpperCase()}`]?.trim() || null;

  try {
    const prices = await stripe.prices.list({ lookup_keys: [planName], active: true });
    return prices.data[0]?.id || process.env[`STRIPE_PRICE_${planName.toUpperCase()}`]?.trim() || null;
  } catch (e) {
    console.error("Stripe price lookup failed:", e);
    return process.env[`STRIPE_PRICE_${planName.toUpperCase()}`]?.trim() || null;
  }
}

export async function syncPlanToStripe(opts: {
  planName: string;
  displayName: string;
  monthlyPriceUsd: number;
  maxUsers: number;
  maxChannels: number;
  maxStorageGb: number;
}): Promise<Stripe.Price | null> {
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    let product: Stripe.Product;
    const products = await stripe.products.search({
      query: `metadata["planName"]:"${opts.planName}"`,
    });

    if (products.data.length) {
      product = products.data[0]!;
    } else {
      product = await stripe.products.create({
        name: opts.displayName,
        description: `${opts.maxUsers} users, ${opts.maxChannels} channels, ${opts.maxStorageGb}GB storage`,
        metadata: {
          planName: opts.planName,
          maxUsers: String(opts.maxUsers),
          maxChannels: String(opts.maxChannels),
          maxStorageGb: String(opts.maxStorageGb),
        },
      });
    }

    return await stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(opts.monthlyPriceUsd * 100),
      currency: "usd",
      recurring: { interval: "month", interval_count: 1 },
      lookup_key: opts.planName,
      metadata: { planName: opts.planName },
    });
  } catch (e) {
    console.error("Stripe plan sync failed:", e);
    return null;
  }
}
