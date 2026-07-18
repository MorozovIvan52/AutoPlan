import "./load-env.js";
import { initSentryServer } from "./api/lib/sentry";
import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { getRequestListener } from "@hono/node-server";
import api from "./api/index";
import { WebSocketServer } from "ws";
import { wsClients } from "./api/services/ws";
import { bootstrapChannelsFromEnv } from "./api/setup/bootstrap";
import { ensureAllDbBootstrap, ensureSaasOnStartup } from "./api/lib/db-bootstrap";
import { startAvitoPolling } from "./api/services/avito-poll";
import { startTelegramPolling } from "./api/services/telegram-poll";
import { startTaskReminders } from "./api/services/task-reminders";
import { startAppointmentReminders } from "./api/services/appointment-reminders";
import { startCdekPolling } from "./api/services/cdek-poll";
import { startAvitoCpaMonitor } from "./api/services/avito-cpa-monitor";
import { startZzapUploadScheduler } from "./api/services/zzap-upload";
import { backfillMessageOcr } from "./api/lib/message-ocr";
import { reconcileAllStaleUnread } from "./api/lib/unread-reconcile";
import { authenticateWsUpgrade } from "./api/lib/ws-auth";
import { startSessionCleanup } from "./api/services/session-cleanup";
import { startConvPreviewReconcile } from "./api/services/conv-preview-reconcile";
import { startChatSlaReminders } from "./api/services/chat-sla-reminders";
import { warnIfZzapPublicUrlsBroken } from "./api/lib/zzap-public";
import { backfillOpenLoginSessions } from "./api/lib/activity-track";

const PORT = Number(process.env.PORT) || 4200;
initSentryServer();
const DIST = join(process.cwd(), "dist");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

function serveStatic(url: string, res: import("node:http").ServerResponse): boolean {
  let path = url.split("?")[0];
  if (path === "/" || !extname(path)) path = "/index.html";
  const filePath = join(DIST, path.replace(/^\//, ""));
  if (!filePath.startsWith(DIST)) {
    res.statusCode = 403;
    res.end("Forbidden");
    return true;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const fallback = join(DIST, "index.html");
    if (!existsSync(fallback)) return false;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.end(readFileSync(fallback));
    return true;
  }
  const ext = extname(filePath);
  res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
  if (ext === ".html" || path === "/crm-build-id.json") {
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  } else if (ext === ".js" || ext === ".css") {
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
  }
  res.end(readFileSync(filePath));
  return true;
}

if (!existsSync(join(DIST, "index.html"))) {
  console.error("Нет папки dist/. Сначала выполните: npm run build");
  process.exit(1);
}

const apiListener = getRequestListener(api.fetch);

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api") && !url.startsWith("/api/ws")) {
    return apiListener(req, res);
  }
  if (!serveStatic(url, res)) {
    res.statusCode = 404;
    res.end("Not found");
  }
});

const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", async (req, socket, head) => {
  const url = req.url ?? "";
  if (!url.startsWith("/api/ws")) {
    socket.destroy();
    return;
  }
  try {
    const userId = await authenticateWsUpgrade(req);
    if (!userId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const client = { send: (data: string) => ws.send(data), userId };
      wsClients.add(client);
      ws.on("close", () => wsClients.delete(client));
      ws.on("message", (data) => {
        if (data.toString() === "ping") ws.send("pong");
      });
    });
  } catch {
    socket.destroy();
  }
});

server.listen(PORT, "0.0.0.0", async () => {
  console.log(`${process.env.APP_NAME || "AutoService CRM"}: http://0.0.0.0:${PORT}`);
  await ensureAllDbBootstrap();
  try {
    await ensureSaasOnStartup();
  } catch {
    console.error("[saas] Критическая ошибка бутстрапа — проверьте БД и логи");
  }
  try {
    const boot = await bootstrapChannelsFromEnv();
    for (const line of boot) console.log(`[bootstrap] ${line}`);
  } catch (e: any) {
    console.error("[bootstrap] ошибка:", e.message);
  }
  startAvitoPolling();
  startTelegramPolling();
  startTaskReminders();
  startAppointmentReminders();
  startCdekPolling();
  startAvitoCpaMonitor();
  startZzapUploadScheduler();
  void warnIfZzapPublicUrlsBroken();
  backfillOpenLoginSessions().then((n) => {
    if (n > 0) console.log(`[activity] восстановлено сессий: ${n}`);
  });
  reconcileAllStaleUnread().then((n) => {
    if (n > 0) console.log(`[unread-reconcile] сброшено устаревших «новых»: ${n}`);
  });
  setTimeout(() => {
    backfillMessageOcr(40).then((r) => {
      if (r.indexed > 0) console.log(`[ocr] проиндексировано фото: ${r.indexed} из ${r.processed}`);
    }).catch((e) => console.warn("[ocr] backfill:", e.message));
  }, 120_000);
  startSessionCleanup();
  startConvPreviewReconcile();
  startChatSlaReminders();
});
