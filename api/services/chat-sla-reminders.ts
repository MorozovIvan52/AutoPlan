import { db } from "../database";

import * as schema from "../database/schema";

import { eq, and, inArray } from "drizzle-orm";

import { notifyUser } from "../lib/notify";

import {

  getChatSla,

  formatSlaMinutes,

  SLA_UNREAD_WARN_MIN,

  SLA_READ_NO_REPLY_MIN,

  SLA_DANGER_MIN,

} from "../lib/chat-sla";



let timer: ReturnType<typeof setInterval> | null = null;



function channelHint(channelType: string | null | undefined): string {

  if (!channelType) return "Чат";

  if (channelType.startsWith("avito")) return "Авито";

  if (channelType === "telegram") return "Telegram";

  if (channelType === "whatsapp") return "WhatsApp";

  return channelType;

}



async function notifyChatSla(

  conv: typeof schema.conversations.$inferSelect,

  clientName: string,

  minutes: number,

  level: "warn" | "danger",

  readNoReply: boolean,

) {

  const operators = await db.select().from(schema.users).where(eq(schema.users.isActive, true));

  const targets = conv.assignedTo

    ? operators.filter((op) => op.id === conv.assignedTo)

    : operators;



  const link = `/?conv=${conv.id}`;

  const ch = channelHint(conv.channelType);

  const wait = formatSlaMinutes(minutes);

  const type = level === "danger" ? "chat_sla_danger" as const : "chat_sla_warn" as const;

  const title = readNoReply

    ? (level === "danger"

      ? `🔴 БЕЗ ОТВЕТА ${wait}: ${clientName}`

      : `⚠️ БЕЗ ОТВЕТА ${wait}: ${clientName}`)

    : (level === "danger"

      ? `🔴 Чат без ответа ${wait}: ${clientName}`

      : `⚠️ Чат без ответа ${wait}: ${clientName}`);

  const text = readNoReply

    ? (level === "danger"

      ? `${ch} · Прочитали, но не ответили — срочно напишите клиенту`

      : `${ch} · Диалог прочитан ${wait} назад — клиент ждёт ответа`)

    : (level === "danger"

      ? `${ch} · Срочно ответьте — на Авито возможен штраф за долгий ответ`

      : `${ch} · Ответьте клиенту — на Авито возможен штраф (норма до 15 мин)`);



  for (const op of targets) {

    await notifyUser({

      userId: op.id,

      type,

      title,

      text,

      link,

    });

  }

}



async function processChatSlaReminders() {

  const now = new Date();



  const rows = await db

    .select({ conv: schema.conversations, client: schema.clients })

    .from(schema.conversations)

    .innerJoin(schema.clients, eq(schema.conversations.clientId, schema.clients.id))

    .where(inArray(schema.conversations.status, ["open", "pending"]));



  for (const { conv, client } of rows) {

    const lastMessage = {

      senderType: conv.lastMessageSenderType,

      text: conv.lastMessageText,

      createdAt: conv.lastMessageAt,

    };

    const sla = getChatSla(conv.unreadCount, lastMessage, conv.lastMessageAt);

    if (!sla.urgent) continue;



    const warnThreshold = sla.readNoReply ? SLA_READ_NO_REPLY_MIN : SLA_UNREAD_WARN_MIN;

    if (sla.minutes < warnThreshold) continue;



    const name = client.name || "Клиент";



    if (sla.minutes >= SLA_DANGER_MIN && !conv.slaDangerNotifiedAt) {

      await notifyChatSla(conv, name, sla.minutes, "danger", sla.readNoReply);

      await db.update(schema.conversations).set({

        slaDangerNotifiedAt: now,

        slaWarnedAt: conv.slaWarnedAt ?? now,

      }).where(eq(schema.conversations.id, conv.id));

      continue;

    }



    if (sla.minutes >= warnThreshold && !conv.slaWarnedAt) {

      await notifyChatSla(conv, name, sla.minutes, "warn", sla.readNoReply);

      await db.update(schema.conversations).set({ slaWarnedAt: now }).where(eq(schema.conversations.id, conv.id));

    }

  }

}



export function startChatSlaReminders() {

  if (timer) return;

  const tick = async () => {

    try {

      await processChatSlaReminders();

    } catch (e) {

      console.error("[chat-sla-reminders] ошибка:", e);

    }

  };

  tick();

  timer = setInterval(tick, 60_000);

  console.log("[chat-sla-reminders] оповещение: 15+ мин непрочитанные, 60+ критично");

}

