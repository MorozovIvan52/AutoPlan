import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, isNull, inArray, gte, lte } from "drizzle-orm";
import { sendToClientPreferred } from "../lib/client-notify";
import { formatAppointmentReminder } from "../lib/service-format";

let timer: ReturnType<typeof setInterval> | null = null;

const MS_DAY = 24 * 60 * 60 * 1000;
const WINDOW_MS = 2 * 60 * 60 * 1000; // ±2ч от 24ч до записи

export function startAppointmentReminders() {
  if (timer) return;

  const tick = async () => {
    try {
      const now = Date.now();
      const from = new Date(now + MS_DAY - WINDOW_MS);
      const to = new Date(now + MS_DAY + WINDOW_MS);

      const rows = await db.select({
        appt: schema.serviceAppointments,
        client: schema.clients,
      })
        .from(schema.serviceAppointments)
        .leftJoin(schema.clients, eq(schema.serviceAppointments.clientId, schema.clients.id))
        .where(and(
          inArray(schema.serviceAppointments.status, ["scheduled", "confirmed"]),
          isNull(schema.serviceAppointments.reminderSentAt),
          gte(schema.serviceAppointments.scheduledAt, from),
          lte(schema.serviceAppointments.scheduledAt, to),
        ));

      const [settings] = await db.select().from(schema.serviceSettings).limit(1);

      for (const { appt, client } of rows) {
        if (!appt.scheduledAt) continue;
        const text = formatAppointmentReminder(appt, {
          name: client?.name,
          phone: client?.phone || appt.phone,
        }, settings);

        await sendToClientPreferred({
          clientId: appt.clientId,
          phone: appt.phone || client?.phone,
          text,
          preferredMessenger: client?.preferredMessenger,
        });

        await db.update(schema.serviceAppointments)
          .set({ reminderSentAt: new Date(), updatedAt: new Date() })
          .where(eq(schema.serviceAppointments.id, appt.id));
      }
    } catch (e) {
      console.error("[appointment-reminders] ошибка:", e);
    }
  };

  tick();
  timer = setInterval(tick, 5 * 60 * 1000);
  console.log("[appointment-reminders] проверка каждые 5 мин (за сутки до записи)");
}
