import { ACTIVE_APPOINTMENT_STATUSES } from "./appointment-schedule";

export type DaySchedule = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

export type ExistingAppointment = {
  scheduledAt: Date;
  durationMin: number | null;
  bayNumber: number | null;
  status: string;
};

function parseHm(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function overlaps(
  slotStart: Date,
  slotEnd: Date,
  appt: ExistingAppointment,
): boolean {
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(appt.status as typeof ACTIVE_APPOINTMENT_STATUSES[number])) {
    return false;
  }
  const aStart = appt.scheduledAt.getTime();
  const aEnd = aStart + (appt.durationMin || 60) * 60_000;
  return slotStart.getTime() < aEnd && slotEnd.getTime() > aStart;
}

export function generateDaySlots(
  date: Date,
  schedule: DaySchedule[],
  bayCount: number,
  existing: ExistingAppointment[],
  slotMin = 60,
): { time: string; bay: number }[] {
  const dow = date.getDay();
  const day = schedule.find((s) => s.dayOfWeek === dow);
  if (!day || day.isClosed) return [];

  const openMin = parseHm(day.openTime);
  const closeMin = parseHm(day.closeTime);
  if (closeMin <= openMin) return [];

  const slots: { time: string; bay: number }[] = [];
  const y = date.getFullYear();
  const mo = date.getMonth();
  const d = date.getDate();

  for (let min = openMin; min + slotMin <= closeMin; min += slotMin) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const time = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    const slotStart = new Date(y, mo, d, h, m, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + slotMin * 60_000);

    for (let bay = 1; bay <= bayCount; bay++) {
      const busy = existing.some(
        (a) => (a.bayNumber == null || a.bayNumber === bay) && overlaps(slotStart, slotEnd, a),
      );
      if (!busy) slots.push({ time, bay });
    }
  }

  return slots;
}

export function slotsForRange(
  from: Date,
  days: number,
  schedule: DaySchedule[],
  bayCount: number,
  existing: ExistingAppointment[],
): Record<string, { time: string; bay: number }[]> {
  const out: Record<string, { time: string; bay: number }[]> = {};
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() + i);
    d.setHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    out[key] = generateDaySlots(d, schedule, bayCount, existing);
  }
  return out;
}
