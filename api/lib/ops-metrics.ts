import { existsSync, statSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";
import { telemetryPrometheusLines } from "./telemetry-metrics";
import { isProduction } from "./env";
import { countPreviewDesync } from "./conv-preview-audit";
import { sqlPing, usePostgres } from "../database/raw-sql";

const startedAt = Date.now();

export type HealthPayload = {
  status: "ok" | "degraded" | "error";
  service: string;
  version: string;
  buildId?: string;
  uptimeSec: number;
  timestamp: string;
  checks: {
    database: { ok: boolean; path?: string; sizeMb?: number };
    memory: { heapUsedMb: number; heapTotalMb: number; rssMb: number };
    disk?: { uploadsMb?: number };
    previewDesync?: number;
  };
};

export async function collectHealth(): Promise<HealthPayload> {
  const dbPath = process.env.CRM_DB_PATH || "crm.db";
  let dbOk = false;
  let dbSizeMb: number | undefined;

  try {
    dbOk = await sqlPing();
    if (!usePostgres() && existsSync(dbPath)) {
      dbSizeMb = Math.round((statSync(dbPath).size / 1024 / 1024) * 100) / 100;
    }
  } catch {
    dbOk = false;
  }

  const mem = process.memoryUsage();
  const uploadsDir = join(process.cwd(), "uploads");
  let uploadsMb: number | undefined;
  if (existsSync(uploadsDir)) {
    try {
      uploadsMb = folderSizeMb(uploadsDir);
    } catch { /* ignore */ }
  }

  const previewDesync = await collectPreviewDesyncSafe();
  const status = !dbOk ? "error" : previewDesync > 0 ? "degraded" : "ok";

  return {
    status,
    service: "crm",
    version: process.env.npm_package_version || "1.0.0",
    buildId: readBuildId(),
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    timestamp: new Date().toISOString(),
    checks: {
      database: isProduction()
        ? { ok: dbOk, sizeMb: dbSizeMb }
        : { ok: dbOk, path: dbPath, sizeMb: dbSizeMb },
      memory: {
        heapUsedMb: mb(mem.heapUsed),
        heapTotalMb: mb(mem.heapTotal),
        rssMb: mb(mem.rss),
      },
      disk: uploadsMb != null ? { uploadsMb } : undefined,
      previewDesync,
    },
  };
}

async function collectPreviewDesyncSafe(): Promise<number> {
  try {
    return await countPreviewDesync();
  } catch {
    return 0;
  }
}

export async function prometheusMetrics(): Promise<string> {
  const h = await collectHealth();
  const lines = [
    "# HELP crm_up CRM process is running (1=ok)",
    "# TYPE crm_up gauge",
    `crm_up ${h.status === "ok" ? 1 : 0}`,
    "# HELP crm_health_degraded 1 if health status is degraded",
    "# TYPE crm_health_degraded gauge",
    `crm_health_degraded ${h.status === "degraded" ? 1 : 0}`,
    "# HELP crm_preview_desync Conversations with stale last_message preview",
    "# TYPE crm_preview_desync gauge",
    `crm_preview_desync ${h.checks.previewDesync ?? 0}`,
    "# HELP crm_uptime_seconds Process uptime",
    "# TYPE crm_uptime_seconds gauge",
    `crm_uptime_seconds ${h.uptimeSec}`,
    "# HELP crm_heap_used_bytes Node heap used",
    "# TYPE crm_heap_used_bytes gauge",
    `crm_heap_used_bytes ${process.memoryUsage().heapUsed}`,
    "# HELP crm_db_size_bytes SQLite database file size",
    "# TYPE crm_db_size_bytes gauge",
    `crm_db_size_bytes ${(h.checks.database.sizeMb ?? 0) * 1024 * 1024}`,
    "# HELP crm_loadavg_1m System load average 1m",
    "# TYPE crm_loadavg_1m gauge",
    `crm_loadavg_1m ${os.loadavg()[0] ?? 0}`,
    ...telemetryPrometheusLines(),
  ];
  return `${lines.join("\n")}\n`;
}

function mb(n: number) {
  return Math.round((n / 1024 / 1024) * 100) / 100;
}

function readBuildId(): string | undefined {
  try {
    const p = join(process.cwd(), "dist", "crm-build-id.json");
    if (!existsSync(p)) return undefined;
    const data = JSON.parse(readFileSync(p, "utf8")) as { id?: string };
    return data.id;
  } catch {
    return undefined;
  }
}

function folderSizeMb(dir: string): number {
  let total = 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) total += folderSizeMb(p) * 1024 * 1024;
    else total += s.size;
  }
  return Math.round((total / 1024 / 1024) * 100) / 100;
}
