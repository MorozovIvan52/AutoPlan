import { isAvitoSystemMessageText } from "./avito-context";

export type SlaLevel = "ok" | "warn" | "danger";

/** Непрочитанное: предупреждение с 15 мин. */
export const SLA_UNREAD_WARN_MIN = 15;
/** @deprecated Прочитанные без ответа больше не попадают в «Срочно» */
export const SLA_READ_NO_REPLY_MIN = 30;
export const SLA_DANGER_MIN = 60;

export function isSystemChatMessage(text?: string | null): boolean {
  return isAvitoSystemMessageText(text);
}

/** Клиент написал последним — ждёт ответа (даже если в CRM уже прочитали). */
export function isClientAwaitingReply(
  lastMessage: { senderType?: string | null; text?: string | null } | null | undefined,
): boolean {
  if (!lastMessage) return false;
  if (lastMessage.senderType !== "client") return false;
  return !isSystemChatMessage(lastMessage.text);
}

/** Диалог ждёт ответа менеджера — реальное сообщение клиента, не системное. */
export function needsManagerResponse(
  unreadCount: number | null | undefined,
  lastMessage: { senderType?: string | null; text?: string | null } | null | undefined,
): boolean {
  return isClientAwaitingReply(lastMessage);
}

/** @deprecated alias */
export function needsOperatorReply(
  unreadCount: number | null | undefined,
  lastMessage: { senderType?: string | null; text?: string | null } | null | undefined,
): boolean {
  return needsManagerResponse(unreadCount, lastMessage);
}

export function slaLevelFromMinutes(minutes: number): SlaLevel {
  if (minutes < SLA_UNREAD_WARN_MIN) return "ok";
  if (minutes < SLA_DANGER_MIN) return "warn";
  return "danger";
}

function slaLevelForAwaiting(minutes: number, readNoReply: boolean): SlaLevel | null {
  if (readNoReply) {
    if (minutes < SLA_READ_NO_REPLY_MIN) return null;
    if (minutes < SLA_DANGER_MIN) return "warn";
    return "danger";
  }
  if (minutes < SLA_UNREAD_WARN_MIN) return "ok";
  if (minutes < SLA_DANGER_MIN) return "warn";
  return "danger";
}

export function getWaitMinutes(since: Date | string | number | null | undefined): number {
  if (!since) return 0;
  const t = new Date(since).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60_000));
}

export type ChatSlaResult = {
  level: SlaLevel | null;
  minutes: number;
  /** Прочитали в CRM, ответа клиенту нет */
  readNoReply: boolean;
  /** Показывать во вкладке «Срочно» */
  urgent: boolean;
};

export function getChatSla(
  unreadCount: number | null | undefined,
  lastMessage: { senderType?: string | null; text?: string | null; createdAt?: Date | string | number | null } | null | undefined,
  _lastMessageAt?: Date | string | number | null,
): ChatSlaResult {
  if (!isClientAwaitingReply(lastMessage)) {
    return { level: null, minutes: 0, readNoReply: false, urgent: false };
  }

  const minutes = getWaitMinutes(lastMessage!.createdAt);
  const readNoReply = (unreadCount || 0) <= 0;

  // Прочитанные диалоги остаются прочитанными — не показываем в «Срочно» и без бейджа «БЕЗ ОТВЕТА»
  if (readNoReply) {
    return { level: null, minutes, readNoReply: true, urgent: false };
  }

  const level = slaLevelForAwaiting(minutes, false);
  const urgent = minutes >= SLA_UNREAD_WARN_MIN;

  return { level, minutes, readNoReply: false, urgent };
}

export function isUrgentChat(
  unreadCount: number | null | undefined,
  lastMessage: { senderType?: string | null; text?: string | null; createdAt?: Date | string | number | null } | null | undefined,
): boolean {
  return getChatSla(unreadCount, lastMessage).urgent;
}

export function formatSlaMinutes(minutes: number): string {
  if (minutes < 1) return "<1 мин";
  if (minutes < 60) return `${minutes} мин`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h} ч ${m} мин` : `${h} ч`;
}

export function formatSlaBadge(
  sla: ChatSlaResult,
): string {
  if (!sla.level || sla.minutes <= 0) return "\u00a0";
  if (sla.readNoReply) return `БЕЗ ОТВЕТА · ${formatSlaMinutes(sla.minutes)}`;
  return formatSlaMinutes(sla.minutes);
}
