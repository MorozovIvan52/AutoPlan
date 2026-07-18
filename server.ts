import "./load-env.js";
import { initSentryServer } from "./api/lib/sentry";
import { createServer } from "node:http";
import { getRequestListener } from "@hono/node-server";
import { createServer as createViteServer } from "vite";
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
import { reconcileAllStaleUnread } from "./api/lib/unread-reconcile";
import { authenticateWsUpgrade } from "./api/lib/ws-auth";
import { startSessionCleanup } from "./api/services/session-cleanup";
import { startConvPreviewReconcile } from "./api/services/conv-preview-reconcile";
import { startChatSlaReminders } from "./api/services/chat-sla-reminders";

const PORT = Number(process.env.PORT) || 4200;
initSentryServer();

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "spa",
});

const apiListener = getRequestListener(api.fetch);

const server = createServer((req, res) => {
  const url = req.url ?? "/";
  if (url.startsWith("/api") && !url.startsWith("/api/ws")) {
    return apiListener(req, res);
  }
  vite.middlewares(req, res, () => {
    res.statusCode = 404;
    res.end("Not found");
  });
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

server.listen(PORT, async () => {
  console.log(`${process.env.APP_NAME || "AutoService CRM"}: http://localhost:${PORT}`);
  await ensureAllDbBootstrap();
  void ensureSaasOnStartup();
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
  reconcileAllStaleUnread().then((n) => {
    if (n > 0) console.log(`[unread-reconcile] сброшено устаревших «новых»: ${n}`);
  });
  startSessionCleanup();
  startConvPreviewReconcile();
  startChatSlaReminders();
});
