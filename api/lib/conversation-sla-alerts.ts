import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";

/** Сброс флагов SLA-оповещений после ответа оператора. */
export async function clearConversationSlaAlerts(conversationId: number) {
  await db.update(schema.conversations).set({
    slaWarnedAt: null,
    slaDangerNotifiedAt: null,
  }).where(eq(schema.conversations.id, conversationId));
}
