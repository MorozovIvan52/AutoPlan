import { log } from "./logger";

const RETRY_STATUSES = new Set([429, 502, 503, 504]);

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableBody(body: string) {
  return /upstream connect error|connection termination|reset before headers|ECONNRESET|ETIMEDOUT|socket hang up/i.test(body);
}

function isRetryableNetworkError(err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|network|abort/i.test(msg);
}

function requestTimeoutMs(init?: RequestInit) {
  if (init?.body instanceof FormData) return 120_000;
  return 45_000;
}

export function formatAvitoApiError(status: number, raw: string): string {
  const err = raw.trim();
  if (status === 402 || /подписк/i.test(err)) {
    return "Нужна платная подписка «API мессенджера» в кабинете Авито";
  }
  if (status === 429) {
    return "Авито: слишком много запросов — подождите минуту и попробуйте снова";
  }
  if (status === 503 || status === 502 || status === 504 || isRetryableBody(err)) {
    return "Авито временно недоступен — подождите 30–60 секунд и отправьте сообщение снова";
  }
  return err.slice(0, 200) || `HTTP ${status}`;
}

/** fetch к api.avito.ru с повторами при кратковременных сбоях + structured logs */
export async function fetchAvitoApi(url: string, init?: RequestInit): Promise<Response> {
  const maxAttempts = 3;
  let lastResponse: Response | null = null;
  let lastBody = "";
  const path = url.replace(/^https?:\/\/[^/]+/, "");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(requestTimeoutMs(init)),
      });

      if (res.ok) {
        if (attempt > 1) {
          log.info({ label: "avito", path, attempt, status: res.status, ms: Date.now() - started }, "avito ok after retry");
        }
        return res;
      }

      const body = await res.text();
      lastBody = body;
      lastResponse = new Response(body, {
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
      });

      const shouldRetry = RETRY_STATUSES.has(res.status) || isRetryableBody(body);
      log.warn(
        { label: "avito", path, attempt, maxAttempts, status: res.status, ms: Date.now() - started, retryable: shouldRetry },
        "avito non-ok",
      );
      if (shouldRetry && attempt < maxAttempts) {
        await delay(800 * attempt);
        continue;
      }
      return lastResponse;
    } catch (err) {
      log.warn(
        {
          label: "avito",
          path,
          attempt,
          maxAttempts,
          ms: Date.now() - started,
          err: err instanceof Error ? err.message : String(err),
        },
        "avito network error",
      );
      if (isRetryableNetworkError(err) && attempt < maxAttempts) {
        await delay(800 * attempt);
        continue;
      }
      throw err instanceof Error
        ? err
        : new Error("Не удалось связаться с API Авито — проверьте интернет и попробуйте снова");
    }
  }

  if (lastResponse) return lastResponse;
  return new Response(lastBody || "Авито: нет ответа", { status: 503 });
}
