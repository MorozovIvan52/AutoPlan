import { db } from "../../database";
import * as schema from "../../database/schema";
import { eq, and } from "drizzle-orm";
import { findClientByPhone } from "./common";
import { formatPhone, isGenericClientName } from "../client-enrich";
import { tenantId, withTenant } from "../tenant-query";

export type CallCardInput = {
  callerName?: string;
  reason?: string;
  vin?: string;
  article?: string;
  createTask?: boolean;
  taskTitle?: string;
};

function buildCallNotes(input: CallCardInput): string | null {
  const parts: string[] = [];
  if (input.reason?.trim()) parts.push(`Причина: ${input.reason.trim()}`);
  if (input.vin?.trim()) parts.push(`VIN: ${input.vin.trim().toUpperCase()}`);
  if (input.article?.trim()) parts.push(`Артикул: ${input.article.trim()}`);
  return parts.length ? parts.join("\n") : null;
}

async function ensureClientVehicle(clientId: number, vin?: string) {
  const v = vin?.trim().toUpperCase();
  if (!v || v.length < 11) return null;
  const existing = await db.select().from(schema.vehicles).where(
    and(eq(schema.vehicles.clientId, clientId), eq(schema.vehicles.vin, v)),
  );
  if (existing.length) return existing[0];
  const [vehicle] = await db.insert(schema.vehicles).values({
    clientId,
    vin: v,
    notes: "Добавлено при входящем звонке",
  }).returning();
  return vehicle;
}

export async function saveIncomingCallCard(
  callId: number,
  userId: number,
  input: CallCardInput,
) {
  const [call] = await db.select().from(schema.callLogs)
    .where(withTenant(schema.callLogs, eq(schema.callLogs.id, callId)));
  if (!call) throw new Error("Звонок не найден");

  let clientId = call.clientId;
  const callerName = input.callerName?.trim() || null;
  const reason = input.reason?.trim() || null;
  const vin = input.vin?.trim().toUpperCase() || null;
  const article = input.article?.trim() || null;

  if (!clientId) {
    const found = await findClientByPhone(call.phone);
    clientId = found?.id ?? null;
  }

  if (!clientId && callerName) {
    const [created] = await db.insert(schema.clients).values({
      name: callerName,
      phone: formatPhone(call.phone) || call.phone,
      source: "phone",
      tenantId: tenantId(),
    }).returning();
    clientId = created.id;
  } else if (clientId && callerName) {
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
    if (client && isGenericClientName(client.name)) {
      await db.update(schema.clients).set({ name: callerName, updatedAt: new Date() })
        .where(eq(schema.clients.id, clientId));
    }
  }

  if (clientId && vin) {
    await ensureClientVehicle(clientId, vin);
    if (article) {
      const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (client && !client.productInterest) {
        await db.update(schema.clients).set({
          productInterest: article,
          updatedAt: new Date(),
        }).where(eq(schema.clients.id, clientId));
      }
    }
  }

  const notes = buildCallNotes({ reason: reason || undefined, vin: vin || undefined, article: article || undefined });

  const [updatedCall] = await db.update(schema.callLogs).set({
    clientId,
    callerName,
    reason,
    vin,
    article,
    notes: notes || call.notes,
    status: call.status === "ringing" ? "answered" : call.status,
    userId: call.userId ?? userId,
  }).where(withTenant(schema.callLogs, eq(schema.callLogs.id, callId))).returning();

  let task = null;
  if (input.createTask) {
    const title = input.taskTitle?.trim()
      || (reason ? `Звонок: ${reason}` : `Перезвонить ${callerName || call.phone}`);
    const descParts = [
      `Телефон: ${call.phone}`,
      callerName ? `Имя: ${callerName}` : null,
      reason ? `Причина: ${reason}` : null,
      vin ? `VIN: ${vin}` : null,
      article ? `Артикул: ${article}` : null,
    ].filter(Boolean);

    const [created] = await db.insert(schema.tasks).values({
      title,
      description: descParts.join("\n"),
      status: "todo",
      priority: "high",
      clientId,
      assignedTo: userId,
      createdBy: userId,
      tenantId: tenantId(),
    }).returning();
    task = created;
  }

  return { call: updatedCall, clientId, task };
}
