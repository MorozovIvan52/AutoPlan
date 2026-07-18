/** Нормализация телефона для WhatsApp / SMS (Россия: 8→7, 10 цифр → 7…) */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return "7" + digits.slice(1);
  if (digits.length === 10 && digits.startsWith("9")) return "7" + digits;
  if (digits.length === 11 && digits.startsWith("7")) return digits;
  return digits;
}

export function whatsappRecipient(phone: string, externalChatId?: string | null): string {
  const fromChat = externalChatId ? normalizePhone(externalChatId) : "";
  if (fromChat.length >= 10) return fromChat;
  return normalizePhone(phone);
}

export function isWhatsAppSessionError(error?: string): boolean {
  if (!error) return false;
  const e = error.toLowerCase();
  return e.includes("24 hour")
    || e.includes("24-hour")
    || e.includes("131047")
    || e.includes("re-engagement")
    || e.includes("template")
    || e.includes("outside the allowed window");
}
