/**
 * SMS.ru — как у АвтоДилер / STOCRM (напоминания о записи, рассылки).
 * SMS_API_ID в .env. Retry + structured logs.
 */
import { normalizePhone } from "./phone";
import { fetchWithRetry } from "./http-retry";
import { log } from "./logger";

export async function sendSms(
  phone: string,
  text: string,
): Promise<{ ok: boolean; error?: string; messageId?: string }> {
  const apiId = process.env.SMS_API_ID?.trim();
  if (!apiId) {
    return { ok: false, error: "SMS_API_ID не задан в .env" };
  }

  const to = normalizePhone(phone).replace(/\D/g, "");
  if (to.length < 10) {
    return { ok: false, error: "Некорректный номер телефона" };
  }

  const params = new URLSearchParams({
    api_id: apiId,
    to,
    msg: text,
    json: "1",
  });

  const url = `https://sms.ru/sms/send?${params}`;
  const masked = to.slice(0, 4) + "****";

  try {
    const res = await fetchWithRetry(url, { method: "GET" }, {
      label: "sms",
      timeoutMs: 15_000,
      maxAttempts: 3,
      logUrl: `https://sms.ru/sms/send?to=${masked}`,
    });
    const data = await res.json() as {
      status?: string;
      status_code?: number;
      sms?: Record<string, { status?: string; status_code?: number; status_text?: string }>;
    };

    if (data.status !== "OK") {
      log.error({ to: masked, status: data.status, status_code: data.status_code }, "sms.ru status fail");
      return { ok: false, error: data.status || "SMS.ru error" };
    }

    const entry = data.sms ? Object.values(data.sms)[0] : undefined;
    if (entry?.status_code !== 100) {
      log.error({ to: masked, status_text: entry?.status_text, status_code: entry?.status_code }, "sms send failed");
      return { ok: false, error: entry?.status_text || "SMS не отправлено" };
    }

    log.info({ to: masked, messageId: entry?.status }, "sms sent");
    return { ok: true, messageId: entry?.status };
  } catch (e: unknown) {
    log.error({ to: masked, err: e instanceof Error ? e.message : String(e) }, "sms request error");
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function smsConfigured(): boolean {
  return Boolean(process.env.SMS_API_ID?.trim());
}
