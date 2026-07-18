/**
 * HTTP retry — паттерн как axios-retry / Avito client.
 * Экспоненциальная задержка, таймаут, логирование попыток.
 */
import { log } from "./logger";

const DEFAULT_RETRY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export type FetchRetryOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
  baseDelayMs?: number;
  retryStatuses?: Set<number>;
  /** Короткая метка для логов: sms, avito, stripe */
  label?: string;
  /** Не логировать URL целиком (секреты в query) */
  logUrl?: string;
};

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /fetch failed|ECONNRESET|ETIMEDOUT|network|abort|TimeoutError|AbortError/i.test(msg);
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts: FetchRetryOptions = {},
): Promise<Response> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const baseDelayMs = opts.baseDelayMs ?? 400;
  const retryStatuses = opts.retryStatuses ?? DEFAULT_RETRY_STATUSES;
  const label = opts.label || "http";
  const logUrl = opts.logUrl || url.replace(/([?&](api_id|token|key|secret)=)[^&]+/gi, "$1***");

  let lastError: unknown;
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(timeoutMs),
      });
      const ms = Date.now() - started;

      if (res.ok) {
        if (attempt > 1) {
          log.info({ label, url: logUrl, attempt, status: res.status, ms }, "http ok after retry");
        }
        return res;
      }

      lastResponse = res;
      const retryable = retryStatuses.has(res.status);
      log.warn(
        { label, url: logUrl, attempt, maxAttempts, status: res.status, ms, retryable },
        "http non-ok",
      );

      if (retryable && attempt < maxAttempts) {
        await delay(baseDelayMs * attempt);
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      const ms = Date.now() - started;
      const retryable = isRetryableNetworkError(err);
      log.warn(
        {
          label,
          url: logUrl,
          attempt,
          maxAttempts,
          ms,
          retryable,
          err: err instanceof Error ? err.message : String(err),
        },
        "http network error",
      );
      if (retryable && attempt < maxAttempts) {
        await delay(baseDelayMs * attempt);
        continue;
      }
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  if (lastResponse) return lastResponse;
  throw lastError instanceof Error ? lastError : new Error(`${label}: no response after ${maxAttempts} attempts`);
}
