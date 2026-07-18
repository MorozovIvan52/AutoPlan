import type * as schema from "../database/schema";

const DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"];
const DAY_SHORT = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

export function formatWeeklySchedule(
  rows: (typeof schema.serviceSchedule.$inferSelect)[],
  settings?: { shopName?: string | null; address?: string | null; phone?: string | null },
): string {
  const sorted = [...rows].sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  const lines = sorted.map((r) => {
    const day = DAY_SHORT[r.dayOfWeek] ?? "?";
    if (r.isClosed) return `${day}: выходной`;
    const note = r.note ? ` (${r.note})` : "";
    return `${day}: ${r.openTime || "09:00"}–${r.closeTime || "18:00"}${note}`;
  });

  let text = "📅 Расписание СТО обновлено\n\n";
  if (settings?.shopName) text += `${settings.shopName}\n`;
  if (settings?.address) text += `📍 ${settings.address}\n`;
  if (settings?.phone) text += `📞 ${settings.phone}\n`;
  if (settings?.shopName || settings?.address || settings?.phone) text += "\n";
  text += lines.join("\n");
  text += "\n\nДля записи напишите в этот чат.";
  return text;
}

export function formatAppointmentMessage(
  appt: typeof schema.serviceAppointments.$inferSelect,
  client?: { name?: string | null; phone?: string | null },
  vehicle?: { vin?: string | null; make?: string | null; model?: string | null; plate?: string | null } | null,
  settings?: { shopName?: string | null; address?: string | null },
): string {
  const dt = new Date(appt.scheduledAt);
  const dateStr = dt.toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });

  const statusLabel: Record<string, string> = {
    scheduled: "Запланировано",
    confirmed: "Подтверждено",
    in_progress: "В работе",
    done: "Готово",
    cancelled: "Отменено",
  };

  let text = `🔧 Запись на ремонт — ${statusLabel[appt.status ?? ""] || appt.status || "—"}\n\n`;
  if (settings?.shopName) text += `${settings.shopName}\n`;
  if (client?.name) text += `Клиент: ${client.name}\n`;
  const phone = client?.phone || appt.phone;
  if (phone) text += `📞 ${phone}\n`;
  text += `📅 ${dateStr}\n`;
  text += `Ремонт: ${appt.title}\n`;
  const carLine = [
    [vehicle?.make || appt.make, vehicle?.model || appt.model].filter(Boolean).join(" "),
    (vehicle?.plate || appt.plate) ? `гос. ${vehicle?.plate || appt.plate}` : "",
    (vehicle?.vin || appt.vin) ? `VIN ${vehicle?.vin || appt.vin}` : "",
    appt.mileage ? `пробег ${appt.mileage}` : "",
  ].filter(Boolean).join(" · ");
  if (carLine) text += `🚗 ${carLine}\n`;
  if (appt.notes) text += `\n${appt.notes}\n`;
  if (settings?.address) text += `\n📍 ${settings.address}`;
  if (appt.status === "cancelled") text += "\n\nЗапись отменена. Для новой записи напишите нам.";
  else text += "\n\nЖдём вас! При изменении планов — сообщите заранее.";
  return text;
}

export function formatAppointmentReminder(
  appt: typeof schema.serviceAppointments.$inferSelect,
  client?: { name?: string | null; phone?: string | null },
  settings?: { shopName?: string | null; address?: string | null },
): string {
  const dt = new Date(appt.scheduledAt);
  const dateStr = dt.toLocaleString("ru-RU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
  let text = "⏰ Напоминание: завтра запись на СТО\n\n";
  if (settings?.shopName) text += `${settings.shopName}\n`;
  if (client?.name) text += `Клиент: ${client.name}\n`;
  const phone = client?.phone || appt.phone;
  if (phone) text += `📞 ${phone}\n`;
  text += `📅 ${dateStr}\n`;
  text += `Ремонт: ${appt.title}\n`;
  if (settings?.address) text += `\n📍 ${settings.address}`;
  text += "\n\nЖдём вас! Если планы изменились — сообщите заранее.";
  return text;
}

export { DAY_NAMES, DAY_SHORT };
