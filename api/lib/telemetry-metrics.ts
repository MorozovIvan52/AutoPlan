import { sendAdvanceAlertTelegram } from "./advance-telegram-alert";

const SPIKE_WINDOW_MS = 5 * 60_000;
const SPIKE_THRESHOLD = 15;
const SPIKE_COOLDOWN_MS = 15 * 60_000;

type LabelMap = Record<string, string>;

const versionMismatch = new Map<string, number>();
const errorBoundary = new Map<string, number>();
const boundaryTimestamps: number[] = [];
let lastSpikeAlertAt = 0;

function labelKey(labels: LabelMap): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${sanitizeLabel(v)}`)
    .join(",");
}

function sanitizeLabel(v: string): string {
  return String(v || "unknown").slice(0, 80).replace(/[^a-zA-Z0-9._\-а-яА-ЯёЁ ]/g, "_");
}

export function incVersionMismatch(source: string, buildId: string) {
  const key = labelKey({ source: sanitizeLabel(source), build_id: sanitizeLabel(buildId) });
  versionMismatch.set(key, (versionMismatch.get(key) || 0) + 1);
}

export function incErrorBoundary(component: string, error: string) {
  const key = labelKey({
    component: sanitizeLabel(component),
    error: sanitizeLabel(error.slice(0, 60)),
  });
  errorBoundary.set(key, (errorBoundary.get(key) || 0) + 1);

  const now = Date.now();
  boundaryTimestamps.push(now);
  while (boundaryTimestamps.length && boundaryTimestamps[0]! < now - SPIKE_WINDOW_MS) {
    boundaryTimestamps.shift();
  }
  if (boundaryTimestamps.length >= SPIKE_THRESHOLD && now - lastSpikeAlertAt > SPIKE_COOLDOWN_MS) {
    lastSpikeAlertAt = now;
    void notifyErrorBoundarySpike(boundaryTimestamps.length);
  }
}

async function notifyErrorBoundarySpike(count: number) {
  const chatId = process.env.CLIENT_ERROR_TELEGRAM_CHAT_ID?.trim()
    || process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
  if (!chatId) return;
  await sendAdvanceAlertTelegram(
    "CRM: всплеск ErrorBoundary",
    `За 5 минут: ${count} срабатываний (порог ${SPIKE_THRESHOLD}).\nПроверьте logs/client-errors.log и /api/metrics`,
    chatId,
  );
}

export function telemetryPrometheusLines(): string[] {
  const lines: string[] = [
    "# HELP crm_version_mismatch_total Client-reported HTML/bundle/API buildId mismatches",
    "# TYPE crm_version_mismatch_total counter",
  ];
  for (const [key, value] of versionMismatch) {
    const labels = key.split(",").map((p) => {
      const [k, v] = p.split("=");
      return `${k}="${v}"`;
    }).join(",");
    lines.push(`crm_version_mismatch_total{${labels}} ${value}`);
  }

  lines.push(
    "# HELP crm_error_boundary_fallback_total React ErrorBoundary fallbacks",
    "# TYPE crm_error_boundary_fallback_total counter",
  );
  for (const [key, value] of errorBoundary) {
    const labels = key.split(",").map((p) => {
      const [k, v] = p.split("=");
      return `${k}="${v}"`;
    }).join(",");
    lines.push(`crm_error_boundary_fallback_total{${labels}} ${value}`);
  }

  lines.push(
    "# HELP crm_error_boundary_recent_5m ErrorBoundary events in rolling 5m window",
    "# TYPE crm_error_boundary_recent_5m gauge",
    `crm_error_boundary_recent_5m ${boundaryTimestamps.length}`,
  );

  return lines;
}
