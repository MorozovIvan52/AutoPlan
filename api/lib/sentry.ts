import * as Sentry from "@sentry/node";

let initialized = false;

export function initSentryServer() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn || initialized) return false;

  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.BUILD_ID,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1),
    beforeSend(event) {
      if (event.request?.headers) {
        delete event.request.headers.cookie;
        delete event.request.headers.authorization;
      }
      return event;
    },
  });
  initialized = true;
  return true;
}

export function captureServerException(error: unknown, context?: Record<string, unknown>) {
  if (!initialized) {
    console.error("[sentry-off]", error, context);
    return;
  }
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureException(error);
  });
}

export function captureServerMessage(
  message: string,
  level: Sentry.SeverityLevel = "info",
  context?: Record<string, unknown>,
) {
  if (!initialized) {
    console.log(`[sentry-off] ${level}: ${message}`, context);
    return;
  }
  Sentry.withScope((scope) => {
    if (context) {
      for (const [k, v] of Object.entries(context)) {
        scope.setExtra(k, v);
      }
    }
    Sentry.captureMessage(message, level);
  });
}

/** Алерт для биллинга: payment_failed, bootstrap errors, webhook failures */
export function alertBillingIssue(opts: {
  event: "payment_failed" | "webhook_error" | "bootstrap_failed" | "subscription_expired";
  tenantId?: number;
  details?: string;
  error?: unknown;
}) {
  const msg = `billing:${opts.event}${opts.tenantId ? ` tenant=${opts.tenantId}` : ""}`;
  if (opts.error) {
    captureServerException(opts.error, { billingEvent: opts.event, tenantId: opts.tenantId, details: opts.details });
  } else {
    captureServerMessage(msg, "warning", { billingEvent: opts.event, tenantId: opts.tenantId, details: opts.details });
  }
}

export { Sentry };
