/**
 * POST /api/support/chat — мультиагентная поддержка СТО.
 */
import { Hono } from "hono";
import { requireAuth } from "../../middleware/auth";
import { getTenantId } from "../../lib/tenant-context";
import { log } from "../../lib/logger";
import { runSupportOrchestrator } from "../../lib/support-orchestrator";

type Body = {
  tenantId?: number;
  customerId?: number | null;
  clientId?: number | null;
  conversationId?: number | null;
  message?: string;
};

export const supportChat = new Hono()
  .use("*", requireAuth)
  .post("/chat", async (c) => {
    const body = await c.req.json().catch(() => ({} as Body));
    const sessionTenantId = getTenantId();
    const userId = c.get("userId") as number | undefined;

    // Не доверяем чужому tenantId из тела — только совпадение с сессией
    if (body.tenantId != null && Number(body.tenantId) !== sessionTenantId) {
      log.warn(
        { bodyTenantId: body.tenantId, sessionTenantId, userId },
        "support chat tenant mismatch",
      );
      return c.json({ error: "tenantId не совпадает с сессией" }, 403);
    }

    const message = String(body.message || "").trim();
    if (!message) return c.json({ error: "Укажите message" }, 400);

    const customerId = body.customerId ?? body.clientId ?? null;
    const clientId = customerId != null ? Number(customerId) : null;
    if (clientId != null && Number.isNaN(clientId)) {
      return c.json({ error: "Некорректный customerId" }, 400);
    }

    try {
      const result = await runSupportOrchestrator({
        clientId,
        conversationId: body.conversationId != null ? Number(body.conversationId) : null,
        message,
        userId: userId ?? null,
      });

      return c.json({
        conversationId: result.conversationId,
        response: result.response,
        agentsUsed: result.agentsUsed,
        escalated: result.escalated,
        taskId: result.taskId ?? null,
        busy: result.busy ?? false,
      }, 200);
    } catch (e: unknown) {
      const err = e as { message?: string; status?: number };
      const status = err.status === 404 ? 404 : err.status === 400 ? 400 : 500;
      log.error(
        { err: err.message, tenantId: sessionTenantId, userId },
        "support chat failed",
      );
      return c.json({ error: err.message || "Ошибка поддержки" }, status);
    }
  });
