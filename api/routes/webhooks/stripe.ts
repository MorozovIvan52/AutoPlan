/**
 * api/routes/webhooks/stripe.ts — Stripe webhooks (Hono raw body + constructEventAsync + idempotency)
 * Референс: https://hono.dev/examples/stripe-webhook + Stripe event.id dedupe.
 */

import { Hono } from "hono";
import { getStripe } from "../../lib/stripe-client";
import { handleStripeWebhook } from "../../lib/stripe-integration";
import { alertBillingIssue } from "../../lib/sentry";
import {
  claimStripeEvent,
  markStripeEventFailed,
  markStripeEventOk,
} from "../../lib/stripe-webhook-events";
import { log } from "../../lib/logger";
import { checkWebhookRateLimit, clientIp } from "../../middleware/security";

const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET?.trim() || "";

export const stripeWebhook = new Hono()
  .post("/", async (c) => {
    const rl = checkWebhookRateLimit(clientIp(c));
    if (!rl.ok) {
      return c.json({ error: "Too many requests", retryAfterSec: rl.retryAfterSec }, 429);
    }

    const secret = webhookSecret();
    if (!secret) {
      log.error({}, "STRIPE_WEBHOOK_SECRET not set");
      return c.json({ error: "Webhook not configured" }, 500);
    }

    const stripe = getStripe();
    if (!stripe) return c.json({ error: "Stripe not configured" }, 503);

    const signature = c.req.header("stripe-signature");
    if (!signature) return c.json({ error: "Missing signature" }, 400);

    let eventId = "";
    let eventType = "";

    try {
      const body = await c.req.text();
      const event = await stripe.webhooks.constructEventAsync(body, signature, secret);
      eventId = event.id;
      eventType = event.type;

      const claim = await claimStripeEvent(event.id, event.type, body);
      if (claim.kind === "duplicate") {
        log.info({ eventId: event.id, type: event.type, status: claim.status }, "stripe webhook duplicate skipped");
        return c.json({ received: true, duplicate: true });
      }

      log.info(
        { eventId: event.id, type: event.type, livemode: event.livemode, claim: claim.kind, attempts: claim.kind === "retry" ? claim.attempts : 1 },
        "stripe webhook received",
      );

      try {
        await handleStripeWebhook(event);
        await markStripeEventOk(event.id);
        log.info({ eventId: event.id, type: event.type }, "stripe webhook processed");
      } catch (procErr) {
        const msg = procErr instanceof Error ? procErr.message : String(procErr);
        await markStripeEventFailed(event.id, msg);
        log.error({ eventId: event.id, type: event.type, err: msg }, "stripe webhook handler failed");
        alertBillingIssue({ event: "webhook_error", error: procErr, details: `${event.type}:${event.id}` });
        // 500 → Stripe повторит; idempotency по id после успеха защитит
        return c.json({ error: "Processing failed" }, 500);
      }

      return c.json({ received: true });
    } catch (e) {
      log.error({ eventId, eventType, err: e instanceof Error ? e.message : String(e) }, "stripe webhook verify/process error");
      alertBillingIssue({ event: "webhook_error", error: e, details: c.req.path });
      return c.json({ error: "Webhook processing failed" }, 400);
    }
  });
