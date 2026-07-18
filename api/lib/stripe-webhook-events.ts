/**
 * Idempotency + dead-letter для Stripe webhooks (event.id).
 * Паттерн: claim → process → ok | error(+DLQ payload) → Stripe retry на 500.
 */
import { sqlExec, sqlGet, sqlRun, sqlAll, usePostgres } from "../database/raw-sql";
import { log } from "./logger";

export async function ensureStripeWebhookEventsTable(): Promise<void> {
  if (usePostgres()) {
    await sqlExec(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        error TEXT,
        payload TEXT,
        attempts INTEGER NOT NULL DEFAULT 1,
        received_at BIGINT NOT NULL,
        processed_at BIGINT
      );
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received ON stripe_webhook_events(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status ON stripe_webhook_events(status);
    `);
  } else {
    await sqlExec(`
      CREATE TABLE IF NOT EXISTS stripe_webhook_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'processing',
        error TEXT,
        payload TEXT,
        attempts INTEGER NOT NULL DEFAULT 1,
        received_at INTEGER NOT NULL,
        processed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_received ON stripe_webhook_events(received_at DESC);
      CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_status ON stripe_webhook_events(status);
    `);
  }

  // soft migrate older DBs
  try {
    await sqlExec("ALTER TABLE stripe_webhook_events ADD COLUMN payload TEXT");
  } catch { /* exists */ }
  try {
    await sqlExec("ALTER TABLE stripe_webhook_events ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1");
  } catch { /* exists */ }
}

export type StripeEventClaim =
  | { kind: "new" }
  | { kind: "duplicate"; status: string }
  | { kind: "retry"; attempts: number };

/** Захватить event.id. duplicate (ok|processing) → skip. error → retry. */
export async function claimStripeEvent(
  eventId: string,
  type: string,
  payloadJson?: string,
): Promise<StripeEventClaim> {
  await ensureStripeWebhookEventsTable();
  const existing = await sqlGet<{ status: string; attempts: number | null }>(
    "SELECT status, attempts FROM stripe_webhook_events WHERE id = ?",
    eventId,
  );
  if (existing) {
    if (existing.status === "ok") return { kind: "duplicate", status: existing.status };
    if (existing.status === "processing") return { kind: "duplicate", status: existing.status };
    const attempts = (existing.attempts || 1) + 1;
    await sqlRun(
      `UPDATE stripe_webhook_events
       SET status = 'processing', error = NULL, received_at = ?, attempts = ?, payload = COALESCE(?, payload)
       WHERE id = ?`,
      Date.now(),
      attempts,
      payloadJson ?? null,
      eventId,
    );
    return { kind: "retry", attempts };
  }

  try {
    await sqlRun(
      `INSERT INTO stripe_webhook_events (id, type, status, payload, attempts, received_at)
       VALUES (?, ?, 'processing', ?, 1, ?)`,
      eventId,
      type,
      payloadJson ?? null,
      Date.now(),
    );
    return { kind: "new" };
  } catch (e) {
    log.warn({ eventId, type, err: e instanceof Error ? e.message : String(e) }, "stripe claim race");
    return { kind: "duplicate", status: "processing" };
  }
}

export async function markStripeEventOk(eventId: string): Promise<void> {
  await sqlRun(
    "UPDATE stripe_webhook_events SET status = 'ok', processed_at = ?, error = NULL WHERE id = ?",
    Date.now(),
    eventId,
  );
}

export async function markStripeEventFailed(eventId: string, error: string): Promise<void> {
  await sqlRun(
    "UPDATE stripe_webhook_events SET status = 'error', processed_at = ?, error = ? WHERE id = ?",
    Date.now(),
    error.slice(0, 500),
    eventId,
  );
}

/** Dead-letter: события со status=error (для ops / ручного replay). */
export async function listStripeDeadLetters(limit = 50): Promise<Array<{
  id: string;
  type: string;
  error: string | null;
  attempts: number | null;
  received_at: number;
}>> {
  await ensureStripeWebhookEventsTable();
  return sqlAll(
    `SELECT id, type, error, attempts, received_at FROM stripe_webhook_events
     WHERE status = 'error' ORDER BY received_at DESC LIMIT ?`,
    limit,
  );
}

export async function getStripeEventPayload(eventId: string): Promise<string | null> {
  const row = await sqlGet<{ payload: string | null }>(
    "SELECT payload FROM stripe_webhook_events WHERE id = ?",
    eventId,
  );
  return row?.payload ?? null;
}
