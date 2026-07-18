/**
 * api/routes/admin/billing.ts — управление подписками и биллингом
 */

import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { db } from "../../database";
import * as schema from "../../database/schema";
import { requireAuth, requireAdmin } from "../../middleware/auth";
import { resolveTenant } from "../../middleware/tenant";
import { getPlanLimits } from "../../lib/tenant";
import { getStripe } from "../../lib/stripe-client";
import { getTenantQuotas, updateUsage } from "../../lib/quota-enforcement";
import { ensureTenantSubscription } from "../../lib/saas-bootstrap";
import { notifyBillingEvent } from "../../lib/mail";
import { getAuthUser } from "../../lib/session";
import { clientIp } from "../../middleware/security";

function formatLimits(quotas: Awaited<ReturnType<typeof getTenantQuotas>>) {
  return {
    users: {
      used: quotas.users.used,
      limit: quotas.users.limit,
      percentage: quotas.users.percentage,
      warning: quotas.users.isWarning,
    },
    channels: {
      used: quotas.channels.used,
      limit: quotas.channels.limit,
      percentage: quotas.channels.percentage,
      warning: quotas.channels.isWarning,
    },
    storage: {
      used: quotas.storage.used,
      limit: quotas.storage.limit,
      percentage: quotas.storage.percentage,
      warning: quotas.storage.isWarning,
    },
  };
}

export const adminBilling = new Hono()
  .use("*", resolveTenant)
  .use("*", requireAuth)
  .use("*", requireAdmin)

  .get("/subscription", async (c) => {
    const tenantId = Number(c.get("tenantId"));
    if (!tenantId) return c.json({ error: "Tenant not found" }, 400);

    await ensureTenantSubscription(tenantId);
    await updateUsage(tenantId);

    const sub = await db
      .select({
        id: schema.tenantSubscriptions.id,
        status: schema.tenantSubscriptions.status,
        planId: schema.tenantSubscriptions.planId,
        startedAt: schema.tenantSubscriptions.startedAt,
        trialEndsAt: schema.tenantSubscriptions.trialEndsAt,
        renewsAt: schema.tenantSubscriptions.renewsAt,
        autoRenew: schema.tenantSubscriptions.autoRenew,
        nextBillingDate: schema.tenantSubscriptions.nextBillingDate,
        planName: schema.subscriptionPlans.name,
        displayName: schema.subscriptionPlans.displayName,
        monthlyPrice: schema.subscriptionPlans.monthlyPriceUsd,
      })
      .from(schema.tenantSubscriptions)
      .innerJoin(
        schema.subscriptionPlans,
        eq(schema.tenantSubscriptions.planId, schema.subscriptionPlans.id),
      )
      .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
      .limit(1);

    if (!sub.length) {
      return c.json({ error: "No subscription found" }, 404);
    }

    const [usage] = await db
      .select()
      .from(schema.tenantUsage)
      .where(eq(schema.tenantUsage.tenantId, tenantId))
      .orderBy(desc(schema.tenantUsage.recordedAt))
      .limit(1);

    const quotas = await getTenantQuotas(tenantId);
    const plan = getPlanLimits(sub[0]!.planName);

    return c.json({
      subscription: sub[0],
      usage: usage ?? null,
      limits: formatLimits(quotas),
      plan,
      daysUntilRenewal: sub[0]!.renewsAt
        ? Math.ceil((sub[0]!.renewsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null,
      daysRemainingInTrial: sub[0]!.trialEndsAt
        ? Math.ceil((sub[0]!.trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
        : null,
    });
  })

  .post("/upgrade", async (c) => {
    const tenantId = Number(c.get("tenantId"));
    const { planId, billingIntervalMonths } = await c.req.json<{
      planId: number;
      billingIntervalMonths?: number;
    }>();

    if (!planId) return c.json({ error: "planId required" }, 400);

    const currentSub = await db
      .select()
      .from(schema.tenantSubscriptions)
      .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
      .limit(1);

    if (!currentSub.length) return c.json({ error: "No subscription found" }, 404);

    const [newPlan] = await db
      .select()
      .from(schema.subscriptionPlans)
      .where(eq(schema.subscriptionPlans.id, planId))
      .limit(1);

    if (!newPlan) return c.json({ error: "Plan not found" }, 404);

    try {
      const now = new Date();
      const renewsAt = new Date(Date.now() + (billingIntervalMonths ?? 1) * 30 * 24 * 60 * 60 * 1000);

      await db.insert(schema.auditLogs).values({
        tenantId,
        action: "subscription.plan_upgraded",
        resourceType: "subscription",
        resourceId: String(currentSub[0]!.id),
        details: JSON.stringify({
          oldPlanId: currentSub[0]!.planId,
          newPlanId: planId,
          reason: "Admin initiated upgrade",
        }),
        ipAddress: clientIp(c),
      });

      await db
        .update(schema.tenantSubscriptions)
        .set({
          planId,
          status: "active",
          renewsAt,
          nextBillingDate: renewsAt,
          updatedAt: now,
        })
        .where(eq(schema.tenantSubscriptions.id, currentSub[0]!.id));

      const limits = getPlanLimits(newPlan.name);
      await db
        .update(schema.tenants)
        .set({
          maxUsers: limits.maxUsers,
          subscriptionPlan: newPlan.name,
          subscriptionStatus: "active",
        })
        .where(eq(schema.tenants.id, tenantId));

      await updateUsage(tenantId);

      return c.json({ ok: true, renewsAt });
    } catch (e) {
      console.error("Upgrade error:", e);
      return c.json({ error: "Upgrade failed" }, 500);
    }
  })

  .post("/cancel", async (c) => {
    const tenantId = Number(c.get("tenantId"));
    const { reason } = await c.req.json<{ reason?: string }>();

    const sub = await db
      .select()
      .from(schema.tenantSubscriptions)
      .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
      .limit(1);

    if (!sub.length) return c.json({ error: "No subscription found" }, 404);

    const now = new Date();
    const user = await getAuthUser(c);

    await db.insert(schema.auditLogs).values({
      tenantId,
      userId: user?.id,
      action: "subscription.canceled",
      resourceType: "subscription",
      resourceId: String(sub[0]!.id),
      details: JSON.stringify({ reason: reason || "Admin initiated", at: now }),
      ipAddress: clientIp(c),
    });

    await db
      .update(schema.tenantSubscriptions)
      .set({ status: "canceled", canceledAt: now, updatedAt: now })
      .where(eq(schema.tenantSubscriptions.id, sub[0]!.id));

    await db
      .update(schema.tenants)
      .set({ subscriptionStatus: "expired" })
      .where(eq(schema.tenants.id, tenantId));

    if (user?.email) {
      const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
      void notifyBillingEvent({
        to: user.email,
        tenantName: tenant?.name || "CRM",
        event: "canceled",
        details: reason,
      });
    }

    return c.json({ ok: true, canceledAt: now });
  })

  .get("/invoices", async (c) => {
    const tenantId = Number(c.get("tenantId"));
    const limit = Math.min(Number(c.req.query("limit")) || 50, 100);
    const offset = Number(c.req.query("offset")) || 0;

    const invoices = await db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.tenantId, tenantId))
      .orderBy(desc(schema.invoices.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ invoices, total: invoices.length, limit, offset });
  })

  .post("/stripe-portal", async (c) => {
    const tenantId = Number(c.get("tenantId"));
    const stripe = getStripe();
    if (!stripe) return c.json({ error: "Stripe не настроен (STRIPE_SECRET_KEY)" }, 503);

    const sub = await db
      .select()
      .from(schema.tenantSubscriptions)
      .where(eq(schema.tenantSubscriptions.tenantId, tenantId))
      .limit(1);

    if (!sub.length || !sub[0]!.stripeCustomerId) {
      return c.json({ error: "No Stripe customer found" }, 404);
    }

    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: sub[0]!.stripeCustomerId,
        return_url: `${process.env.PUBLIC_URL || "http://localhost:4200"}/admin/billing`,
      });
      return c.json({ url: session.url });
    } catch (e) {
      console.error("Stripe portal error:", e);
      return c.json({ error: "Failed to create portal session" }, 500);
    }
  });
