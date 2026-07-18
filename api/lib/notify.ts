import { db } from "../database";
import * as schema from "../database/schema";
import { broadcastToUser } from "../services/ws";

type NotifyOpts = {
  userId: number;
  type: "new_message" | "assigned" | "tag_added" | "deal_updated" | "mention" | "task_due" | "task_reminder_15" | "task_reminder_5" | "task_overdue" | "avito_advance" | "avito_advance_empty" | "chat_sla_warn" | "chat_sla_danger";
  title: string;
  text?: string;
  link?: string;
};

export async function notifyUser(opts: NotifyOpts) {
  const [notification] = await db.insert(schema.notifications).values({
    userId: opts.userId,
    type: opts.type,
    title: opts.title,
    text: opts.text,
    link: opts.link,
  }).returning();

  broadcastToUser(opts.userId, {
    type: "notification",
    notification,
  });

  return notification;
}
