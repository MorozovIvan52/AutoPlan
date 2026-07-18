import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, isNotNull, inArray } from "drizzle-orm";
import { notifyUser } from "../lib/notify";

const MS_MIN = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

async function clientSuffix(clientId: number | null): Promise<string> {
  if (!clientId) return "";
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  return client?.name ? ` · ${client.name}` : "";
}

function formatDue(dueAt: Date): string {
  return dueAt.toLocaleString("ru-RU", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

async function processTaskReminders() {
  const now = new Date();
  const nowMs = now.getTime();

  const active = await db.select().from(schema.tasks).where(
    and(
      isNotNull(schema.tasks.dueAt),
      isNotNull(schema.tasks.assignedTo),
      inArray(schema.tasks.status, ["todo", "in_progress"]),
    ),
  );

  for (const task of active) {
    if (!task.assignedTo || !task.dueAt) continue;

    const dueMs = task.dueAt.getTime();
    const link = `/tasks?task=${task.id}`;
    const due = formatDue(task.dueAt);
    const clientName = await clientSuffix(task.clientId);

    if (nowMs >= dueMs - 15 * MS_MIN && nowMs < dueMs && !task.reminded15At) {
      await notifyUser({
        userId: task.assignedTo,
        type: "task_reminder_15",
        title: `⏳ Через 15 мин: ${task.title}`,
        text: `Дедлайн ${due}${clientName}`,
        link,
      });
      await db.update(schema.tasks)
        .set({ reminded15At: now, updatedAt: now })
        .where(eq(schema.tasks.id, task.id));
      continue;
    }

    if (nowMs >= dueMs - 5 * MS_MIN && nowMs < dueMs && !task.reminded5At) {
      await notifyUser({
        userId: task.assignedTo,
        type: "task_reminder_5",
        title: `⏱ Через 5 мин: ${task.title}`,
        text: `Дедлайн ${due}${clientName}`,
        link,
      });
      await db.update(schema.tasks)
        .set({ reminded5At: now, updatedAt: now })
        .where(eq(schema.tasks.id, task.id));
      continue;
    }

    if (nowMs >= dueMs && !task.notifiedAt) {
      await notifyUser({
        userId: task.assignedTo,
        type: "task_due",
        title: `⏰ Срок задачи: ${task.title}`,
        text: `Дедлайн ${due}${clientName}`,
        link,
      });
      await db.update(schema.tasks)
        .set({ notifiedAt: now, updatedAt: now })
        .where(eq(schema.tasks.id, task.id));
      continue;
    }

    if (nowMs > dueMs && !task.overdueNotifiedAt) {
      await notifyUser({
        userId: task.assignedTo,
        type: "task_overdue",
        title: `🔴 Просрочена: ${task.title}`,
        text: `Был дедлайн ${due}${clientName}`,
        link,
      });
      await db.update(schema.tasks)
        .set({ overdueNotifiedAt: now, updatedAt: now })
        .where(eq(schema.tasks.id, task.id));
    }
  }
}

export function startTaskReminders() {
  if (timer) return;
  const tick = async () => {
    try {
      await processTaskReminders();
    } catch (e) {
      console.error("[task-reminders] ошибка:", e);
    }
  };

  tick();
  timer = setInterval(tick, 30_000);
  console.log("[task-reminders] 15/5 мин, срок и просрочка — каждые 30с");
}
