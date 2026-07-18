import { db } from "../../database";
import * as schema from "../../database/schema";
import { eq, and } from "drizzle-orm";
import { notifyUser } from "../notify";
import { broadcastToUser, broadcastToUsers } from "../../services/ws";
import { forTenant, tenantId, withTenant } from "../tenant-query";
import { getTenantId, runWithTenant } from "../tenant-context";
import { sqlAll } from "../../database/raw-sql";
import { timingSafeEqualText } from "../../middleware/security";

import { phonesMatch } from "../phone-normalize";

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 10) return "7" + digits;
  return digits;
}

export { phonesMatch };

export async function findClientByPhone(phone: string) {
  const rows = await db.select().from(schema.clients).where(forTenant(schema.clients));
  return rows.find((c) => c.phone && phonesMatch(c.phone, phone)) || null;
}

export async function findUserByExtension(ext: string) {
  if (!ext) return null;
  const [user] = await db.select().from(schema.users).where(
    and(forTenant(schema.users), eq(schema.users.phoneExtension, ext)),
  );
  return user || null;
}

export async function getTelephonySettings() {
  const tid = getTenantId();
  const [row] = await db.select().from(schema.telephonySettings)
    .where(eq(schema.telephonySettings.tenantId, tid)).limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.telephonySettings).values({ tenantId: tid }).returning();
  return created;
}

/** Телефония: определить тенант по webhook-секрету (мультитенант) */
export async function resolveTelephonyTenantBySecret(secret: string): Promise<number | null> {
  if (!secret) return null;
  const rows = await sqlAll<{ tenant_id: number; webhook_secret: string }>(
    "SELECT tenant_id, webhook_secret FROM telephony_settings WHERE webhook_secret IS NOT NULL",
  );
  for (const row of rows) {
    if (timingSafeEqualText(secret, row.webhook_secret)) return row.tenant_id;
  }
  return null;
}

export async function runTelephonyWebhook<T>(secret: string, fn: () => Promise<T>): Promise<T> {
  const tid = (await resolveTelephonyTenantBySecret(secret)) ?? getTenantId();
  return runWithTenant({ tenantId: tid }, fn);
}

type LogCallOpts = {
  phone: string;
  direction: "inbound" | "outbound";
  provider: "manual" | "megafon" | "mts";
  externalId?: string | null;
  clientId?: number | null;
  userId?: number | null;
  operatorExt?: string | null;
  status?: "ringing" | "answered" | "completed" | "missed" | "cancelled";
  durationSec?: number | null;
  recordingUrl?: string | null;
  outcome?: "completed" | "no_answer" | "callback" | "wrong_number";
  notes?: string | null;
};

export async function upsertCallLog(opts: LogCallOpts) {
  if (opts.externalId) {
    const [existing] = await db.select().from(schema.callLogs)
      .where(withTenant(schema.callLogs, eq(schema.callLogs.externalId, opts.externalId)));
    if (existing) {
      const [updated] = await db.update(schema.callLogs).set({
        status: opts.status ?? existing.status,
        durationSec: opts.durationSec ?? existing.durationSec,
        recordingUrl: opts.recordingUrl ?? existing.recordingUrl,
        outcome: opts.outcome ?? existing.outcome,
        notes: opts.notes ?? existing.notes,
        clientId: opts.clientId ?? existing.clientId,
        userId: opts.userId ?? existing.userId,
      }).where(withTenant(schema.callLogs, eq(schema.callLogs.id, existing.id))).returning();
      return updated;
    }
  }

  const [call] = await db.insert(schema.callLogs).values({
    phone: opts.phone,
    direction: opts.direction,
    provider: opts.provider,
    externalId: opts.externalId ?? null,
    clientId: opts.clientId ?? null,
    userId: opts.userId ?? null,
    tenantId: tenantId(),
    operatorExt: opts.operatorExt ?? null,
    status: opts.status ?? "completed",
    durationSec: opts.durationSec ?? null,
    recordingUrl: opts.recordingUrl ?? null,
    outcome: opts.outcome ?? (opts.status === "missed" ? "no_answer" : "completed"),
    notes: opts.notes ?? null,
  }).returning();
  return call;
}

export async function notifyIncomingCall(opts: {
  phone: string;
  clientId?: number | null;
  clientName?: string | null;
  userId?: number | null;
  assignedUserId?: number | null;
  callId: number;
}) {
  const title = opts.clientName
    ? `📞 Входящий: ${opts.clientName}`
    : `📞 Входящий: ${opts.phone}`;

  const targetUserId = opts.assignedUserId ?? opts.userId ?? null;

  const callPayload = {
    type: "incoming_call" as const,
    call: {
      id: opts.callId,
      phone: opts.phone,
      clientId: opts.clientId,
      clientName: opts.clientName,
      assignedUserId: targetUserId,
    },
  };

  if (targetUserId) {
    broadcastToUser(targetUserId, callPayload);
  } else {
    const operators = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
    broadcastToUsers(operators.map((o) => o.id), callPayload);
  }

  if (targetUserId) {
    await notifyUser({
      userId: targetUserId,
      type: "mention",
      title,
      text: opts.phone,
      link: opts.clientId ? `/clients` : `/calls`,
    });
    return;
  }

  const operators = await db.select().from(schema.users)
    .where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
  for (const op of operators) {
    await notifyUser({
      userId: op.id,
      type: "mention",
      title,
      text: opts.phone,
      link: `/calls`,
    });
  }
}
