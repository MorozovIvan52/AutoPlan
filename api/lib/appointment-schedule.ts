export const ACTIVE_APPOINTMENT_STATUSES = ["scheduled", "confirmed", "in_progress"] as const;
export const FINAL_APPOINTMENT_STATUSES = ["done", "cancelled"] as const;
export const FINAL_DEAL_STATUSES = ["done", "cancelled"] as const;

export function isAppointmentInSchedule(
  status: string | null,
  dealStatus?: string | null,
): boolean {
  const s = status ?? "";
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(s as (typeof ACTIVE_APPOINTMENT_STATUSES)[number])) {
    return false;
  }
  if (dealStatus && FINAL_DEAL_STATUSES.includes(dealStatus as (typeof FINAL_DEAL_STATUSES)[number])) {
    return false;
  }
  return true;
}
