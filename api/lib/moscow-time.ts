const TZ = "Europe/Moscow";

export function moscowDateKey(d: Date | string | number = new Date()): string {
  return new Date(d).toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Границы календарного дня по Москве (для отчётов активности). */
export function moscowDayBounds(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export function isTodayMoscow(d: Date | string | number | null | undefined): boolean {
  if (!d) return false;
  return moscowDateKey(d) === moscowDateKey(new Date());
}

/** Полночь текущего дня по Москве (как Date в UTC). */
export function startOfTodayMoscow(): Date {
  const key = moscowDateKey(new Date());
  return new Date(`${key}T00:00:00+03:00`);
}
