import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, isNull, lt, or, ne } from "drizzle-orm";
import { broadcast } from "../services/ws";

export type DeliveryStatus = "sent" | "delivered" | "read" | "failed";

const RANK: Record<DeliveryStatus, number> = {
  failed: 0,
  sent: 1,
  delivered: 2,
  read: 3,
};

function normalizeStatus(raw: string): DeliveryStatus | null {
  const s = raw.toLowerCase();
  if (s === "sent" || s === "delivered" || s === "read" || s === "failed") return s;
  return null;
}

export function initialDeliveryStatus(channelType?: string | null): DeliveryStatus | null {
  if (!channelType || channelType === "manual") return null;
  return "sent";
}

export async function applyDeliveryStatus(
  messageId: number,
  conversationId: number,
  next: DeliveryStatus,
) {
  const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
  if (!msg || msg.senderType !== "operator") return;

  const current = msg.deliveryStatus as DeliveryStatus | null;
  if (current && RANK[current] >= RANK[next]) return;

  const patch: Partial<typeof schema.messages.$inferInsert> = { deliveryStatus: next };
  if (next === "read") patch.readAt = new Date();

  await db.update(schema.messages).set(patch).where(eq(schema.messages.id, messageId));
  broadcast({
    type: "message_status",
    conversationId,
    messageId,
    deliveryStatus: next,
    readAt: next === "read" ? new Date().toISOString() : undefined,
  });
}

export async function updateDeliveryByExternalId(
  externalMessageId: string,
  rawStatus: string,
) {
  const status = normalizeStatus(rawStatus);
  if (!status) return;

  const [msg] = await db.select().from(schema.messages)
    .where(eq(schema.messages.externalMessageId, externalMessageId))
    .limit(1);
  if (!msg || msg.senderType !== "operator") return;

  const current = msg.deliveryStatus as DeliveryStatus | null;
  if (current && RANK[current] >= RANK[status]) return;

  const patch: Partial<typeof schema.messages.$inferInsert> = { deliveryStatus: status };
  if (status === "read") patch.readAt = new Date();

  await db.update(schema.messages).set(patch).where(eq(schema.messages.id, msg.id));
  broadcast({
    type: "message_status",
    conversationId: msg.conversationId,
    messageId: msg.id,
    deliveryStatus: status,
    readAt: status === "read" ? new Date().toISOString() : undefined,
  });
}

/** Клиент ответил — считаем предыдущие сообщения оператора прочитанными (Авито, Telegram и др.). */
export async function markOperatorMessagesReadBefore(
  conversationId: number,
  before: Date,
) {
  const rows = await db.select().from(schema.messages).where(and(
    eq(schema.messages.conversationId, conversationId),
    eq(schema.messages.senderType, "operator"),
    or(
      isNull(schema.messages.deliveryStatus),
      ne(schema.messages.deliveryStatus, "read"),
    ),
    lt(schema.messages.createdAt, before),
  ));

  if (!rows.length) return;

  const now = new Date();
  for (const row of rows) {
    const current = row.deliveryStatus as DeliveryStatus | null;
    if (current === "read") continue;
    await db.update(schema.messages).set({ deliveryStatus: "read", readAt: now }).where(eq(schema.messages.id, row.id));
    broadcast({
      type: "message_status",
      conversationId,
      messageId: row.id,
      deliveryStatus: "read",
      readAt: now.toISOString(),
    });
  }
}
