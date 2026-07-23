import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/fetch-api";
import { AppShell } from "../components/AppShell";
import { AppointmentModal } from "../components/AppointmentModal";
import { getWeekStart, addDays, formatWeekLabel, dayHeader, toDateInput } from "../lib/calendar";
import { parseDueAt, defaultReminderTime } from "../lib/datetime";

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Записан",
  confirmed: "Подтверждён",
  in_progress: "В ремонте",
  done: "Готов",
};

const STATUS_COLOR: Record<string, string> = {
  scheduled: "var(--accent)",
  confirmed: "var(--success)",
  in_progress: "var(--warning)",
  done: "var(--text-muted)",
};

const ICON_CAR = "\u{1F697}";
const ICON_WRENCH = "\u{1F527}";

type SlotPick = { date: string; time: string } | null;

function appointmentCar(a: any): string {
  const plate = a.plate || a.vehicle?.plate;
  const make = a.make || a.vehicle?.make;
  const model = a.model || a.vehicle?.model;
  const car = [plate, [make, model].filter(Boolean).join(" ")].filter(Boolean).join(" \u00b7 ");
  if (car) return car;
  if (a.clientName) return a.clientName;
  if (a.clientPhone || a.phone) return a.clientPhone || a.phone;
  return "Авто не указано";
}

export default function CalendarPage() {
  const [weekStart, setWeekStart] = useState(() => getWeekStart(new Date()));
  const [slotPick, setSlotPick] = useState<SlotPick>(null);
  const [editAppt, setEditAppt] = useState<any>(null);

  const from = weekStart.toISOString();
  const to = addDays(weekStart, 7).toISOString();

  const { data, isLoading } = useQuery({
    queryKey: ["calendar-appointments", from],
    queryFn: () =>
      apiFetch<{ appointments: any[] }>(
        `/api/service/appointments?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      ),
  });

  const appointments = (data?.appointments || []).filter((a) => a.status !== "cancelled");

  const byDay = useMemo(() => {
    const weekDates = Array.from({ length: 7 }, (_, i) => toDateInput(addDays(weekStart, i)));
    const groups: any[][] = Array.from({ length: 7 }, () => []);

    for (const a of appointments) {
      const dateStr = toDateInput(new Date(a.scheduledAt));
      const dayIndex = weekDates.indexOf(dateStr);
      if (dayIndex >= 0) groups[dayIndex].push(a);
    }

    for (const list of groups) {
      list.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
    }
    return groups;
  }, [appointments, weekStart]);

  const openNew = (dayIndex: number) => {
    const d = addDays(weekStart, dayIndex);
    const pad = (n: number) => String(n).padStart(2, "0");
    setSlotPick({
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: defaultReminderTime(),
    });
    setEditAppt(null);
  };

  const closeModal = () => {
    setSlotPick(null);
    setEditAppt(null);
  };

  return (
    <AppShell hideTopBar>
      <div className="page-header cal-page-header">
        <h1 className="page-title">Календарь записей</h1>
        <div className="cal-week-nav">
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-sm"
            onClick={() => setWeekStart(addDays(weekStart, -7))}
            aria-label="Предыдущая неделя"
          >
            {"\u2190"}
          </button>
          <span className="cal-week-label">{formatWeekLabel(weekStart)}</span>
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-sm"
            onClick={() => setWeekStart(addDays(weekStart, 7))}
            aria-label="Следующая неделя"
          >
            {"\u2192"}
          </button>
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-sm"
            onClick={() => setWeekStart(getWeekStart(new Date()))}
          >
            Сегодня
          </button>
        </div>
      </div>

      <div className="page-body">
        {isLoading ? (
          <p className="cal-loading">Загрузка…</p>
        ) : (
          <div className="repair-cal">
            {Array.from({ length: 7 }, (_, dayIndex) => {
              const dayAppts = byDay[dayIndex];
              return (
                <div key={dayIndex} className="repair-cal__day">
                  <div className="repair-cal__day-head">
                    <span className="repair-cal__day-title">{dayHeader(weekStart, dayIndex)}</span>
                    <button
                      type="button"
                      className="crm-btn crm-btn-ghost crm-btn-sm repair-cal__add"
                      onClick={() => openNew(dayIndex)}
                    >
                      + Запись
                    </button>
                  </div>
                  <div className="repair-cal__list">
                    {dayAppts.length === 0 ? (
                      <p className="repair-cal__empty">Нет записей</p>
                    ) : (
                      dayAppts.map((a) => {
                        const { time } = parseDueAt(a.scheduledAt);
                        const car = appointmentCar(a);
                        const work = a.title || "Работы не указаны";
                        return (
                          <button
                            key={a.id}
                            type="button"
                            className="repair-cal__card"
                            style={{ borderLeftColor: STATUS_COLOR[a.status] || "var(--accent)" }}
                            onClick={() => {
                              setEditAppt(a);
                              setSlotPick(null);
                            }}
                          >
                            <div className="repair-cal__card-top">
                              <span className="repair-cal__time">{time}</span>
                              <span className="repair-cal__status">
                                {STATUS_LABELS[a.status] || a.status}
                              </span>
                            </div>
                            <p className="repair-cal__car">
                              {ICON_CAR} {car}
                            </p>
                            <p className="repair-cal__work">
                              {ICON_WRENCH} {work}
                            </p>
                            {a.clientName && car !== a.clientName && (
                              <p className="repair-cal__client">{a.clientName}</p>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="cal-hint">
          Показаны только записи с выбранным временем · «+ Запись» — новая · Клик по карточке —
          редактирование
        </p>
      </div>

      {(slotPick || editAppt) && (
        <AppointmentModal
          initialDate={slotPick?.date}
          initialTime={slotPick?.time}
          appointment={editAppt}
          onClose={closeModal}
        />
      )}
    </AppShell>
  );
}
