import { Hono } from "hono";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sendAdvanceAlertTelegram } from "../lib/advance-telegram-alert";
import { incErrorBoundary, incVersionMismatch } from "../lib/telemetry-metrics";
import { clientIp } from "../middleware/security";

const rateByIp = new Map<string, { count: number; resetAt: number }>();
const alertThrottle = new Map<string, number>();
const RATE_MAX = 40;
const RATE_WINDOW_MS = 60_000;
const ALERT_COOLDOWN_MS = 10 * 60_000;

function checkRate(ip: string): boolean {
  const now = Date.now();
  const entry = rateByIp.get(ip);
  if (!entry || now > entry.resetAt) {
    rateByIp.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_MAX) return false;
  entry.count++;
  return true;
}

function appendLog(line: string) {
  const dir = join(process.cwd(), "logs");
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, "client-errors.log"), line + "\n", { encoding: "utf8" });
}

type TelemetryBody = {
  event?: string;
  message?: string;
  stack?: string;
  componentStack?: string;
  url?: string;
  userAgent?: string;
  type?: string;
  source?: string;
  buildId?: string;
  expected?: string;
  sessionId?: string;
  component?: string;
  error?: string;
  lastAction?: string;
  mobile?: boolean;
  platform?: string;
  language?: string;
  ts?: string;
};

export const clientErrors = new Hono()
  .post("/", async (c) => {
    const ip = clientIp(c);
    if (!checkRate(ip)) return c.json({ ok: false, error: "rate_limited" }, 429);

    const body = await c.req.json<TelemetryBody>().catch((): TelemetryBody => ({}));

    if (body.event === "version_mismatch") {
      const source = String(body.source || "unknown").slice(0, 32);
      const buildId = String(body.buildId || "").slice(0, 64);
      const expected = String(body.expected || "").slice(0, 64);
      if (!buildId || !expected) return c.json({ error: "buildId and expected required" }, 400);

      incVersionMismatch(source, buildId);

      const entry = {
        ts: body.ts || new Date().toISOString(),
        event: "version_mismatch",
        ip,
        source,
        buildId,
        expected,
        sessionId: String(body.sessionId || "").slice(0, 64),
        url: String(body.url || "").slice(0, 500),
        userAgent: String(body.userAgent || "").slice(0, 300),
      };
      appendLog(JSON.stringify(entry));
      return c.json({ ok: true }, 200);
    }

    if (body.event === "error_boundary_fallback") {
      const error = String(body.error || body.message || "").slice(0, 2000);
      const component = String(body.component || "root").slice(0, 120);
      if (!error) return c.json({ error: "error required" }, 400);

      incErrorBoundary(component, error);

      const entry = {
        ts: body.ts || new Date().toISOString(),
        event: "error_boundary_fallback",
        ip,
        error,
        component,
        sessionId: String(body.sessionId || "").slice(0, 64),
        buildId: String(body.buildId || "").slice(0, 64),
        url: String(body.url || "").slice(0, 500),
        userAgent: String(body.userAgent || "").slice(0, 300),
        lastAction: String(body.lastAction || "").slice(0, 200),
        mobile: body.mobile,
        platform: body.platform,
        language: body.language,
        stack: String(body.stack || "").slice(0, 4000),
        componentStack: String(body.componentStack || "").slice(0, 4000),
      };
      appendLog(JSON.stringify(entry));

      const isDomError = /insertBefore|removeChild|not a child/i.test(error);
      const chatId = process.env.CLIENT_ERROR_TELEGRAM_CHAT_ID?.trim();
      if (isDomError && chatId) {
        const key = error.slice(0, 120);
        const last = alertThrottle.get(key) || 0;
        if (Date.now() - last > ALERT_COOLDOWN_MS) {
          alertThrottle.set(key, Date.now());
          void sendAdvanceAlertTelegram(
            "CRM: ошибка интерфейса",
            `${error}\nКомпонент: ${component}\n${entry.url}`,
            chatId,
          );
        }
      }

      return c.json({ ok: true }, 200);
    }

    const message = String(body.message || "").slice(0, 2000);
    if (!message) return c.json({ error: "message required" }, 400);

    const entry = {
      ts: body.ts || new Date().toISOString(),
      ip,
      message,
      type: body.type || "client",
      url: String(body.url || "").slice(0, 500),
      userAgent: String(body.userAgent || "").slice(0, 300),
      stack: String(body.stack || "").slice(0, 4000),
      componentStack: String(body.componentStack || "").slice(0, 4000),
      sessionId: String(body.sessionId || "").slice(0, 64),
      buildId: String(body.buildId || "").slice(0, 64),
    };

    appendLog(JSON.stringify(entry));

    const isDomError = /insertBefore|removeChild|not a child/i.test(message);
    const chatId = process.env.CLIENT_ERROR_TELEGRAM_CHAT_ID?.trim();
    if (isDomError && chatId) {
      const key = message.slice(0, 120);
      const last = alertThrottle.get(key) || 0;
      if (Date.now() - last > ALERT_COOLDOWN_MS) {
        alertThrottle.set(key, Date.now());
        void sendAdvanceAlertTelegram(
          "CRM: ошибка интерфейса",
          `${message}\n\n${entry.url}\n${String(body.stack || "").slice(0, 500)}`,
          chatId,
        );
      }
    }

    return c.json({ ok: true }, 200);
  });
