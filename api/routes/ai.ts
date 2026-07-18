import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, asc, desc, and } from "drizzle-orm";
import { jsonApiError } from "../lib/api-error";
import { requireAuth } from "../middleware/auth";
import { llmCompletion, isLlmConfigured, llmProvider, llmModelLabel } from "../lib/llm";
import { isYandexVisionConfigured } from "../lib/yandex-vision";
import { getPreferredOcrEngine } from "../lib/ocr-buffer";
import { parseConvMetadata } from "../lib/conv-meta";
import { AWD_REPAIR_ITEMS, calcAwdQuote, formatAwdQuoteText } from "../lib/awd-repair";
import { runAllScanners, persistProposals, scanChatOpportunities } from "../lib/ai-scanners";
import { sendOutgoing } from "../services/messaging";
import { forTenant, withTenant } from "../lib/tenant-query";
import { getConversationInTenant } from "../lib/tenant-guard";

const SYSTEM_PROMPT = `Ты — ассистент оператора CRM магазина автозапчастей и автосервиса (СТО) в России.
Помогай формулировать вежливые, короткие и по делу ответы клиентам.
Учитывай контекст: VIN, марка авто, товар с Авито, запись на ремонт, наличие на складе.
Не выдумывай цены и наличие — если данных нет, предложи уточнить или перезвонить.
Пиши на русском. Без markdown и без подписи «С уважением».`;

export const ai = new Hono()
  .use("*", requireAuth)
  .get("/status", (c) => {
    const provider = llmProvider();
    const missing: string[] = [];
    if (provider === "none") {
      if (!process.env.AI_API_KEY?.trim()) missing.push("AI_API_KEY");
      if (!process.env.AI_BASE_URL?.trim()) missing.push("AI_BASE_URL");
      if (!process.env.YANDEX_API_KEY) missing.push("YANDEX_API_KEY");
      if (!process.env.YANDEX_FOLDER_ID?.trim()) missing.push("YANDEX_FOLDER_ID");
    }
    return c.json({
      configured: isLlmConfigured(),
      provider,
      hasApiKey: Boolean(process.env.AI_API_KEY?.trim() || process.env.YANDEX_API_KEY),
      hasFolderId: Boolean(process.env.YANDEX_FOLDER_ID?.trim()),
      missing,
      model: llmModelLabel(),
      vision: {
        configured: isYandexVisionConfigured(),
        preferredOcrEngine: getPreferredOcrEngine(),
        model: process.env.YANDEX_VISION_MODEL || "page",
      },
    }, 200);
  })
  .post("/suggest-reply", async (c) => {
    if (!isLlmConfigured()) {
      return c.json({
        error: "AI не настроен. Добавьте AI_API_KEY + AI_BASE_URL или YANDEX_API_KEY + YANDEX_FOLDER_ID в .env",
      }, 503);
    }

    const body = await c.req.json();
    const conversationId = Number(body.conversationId);
    if (!conversationId) return c.json({ error: "Укажите conversationId" }, 400);

    const conv = await getConversationInTenant(conversationId);
    if (!conv) return c.json({ error: "Диалог не найден" }, 404);

    const [client] = await db.select().from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, conv.clientId)));
    const messages = await db.select().from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt));

    const recent = messages.slice(-16);
    const meta = parseConvMetadata(conv.metadata);
    const chatLog = recent.map((m) => {
      const who = m.senderType === "operator" ? "Оператор" : "Клиент";
      return `${who}: ${m.text || "[медиа]"}`;
    }).join("\n");

    const mode = body.mode || "reply";
    let userPrompt = "";

    if (mode === "improve" && body.draftText) {
      userPrompt = `Улучши черновик ответа оператора (сохрани смысл, сделай профессиональнее):\n«${body.draftText}»\n\nКонтекст диалога:\n${chatLog}`;
    } else if (mode === "summarize") {
      userPrompt = `Кратко резюмируй диалог для следующего оператора (3–5 пунктов):\n${chatLog}`;
    } else {
      userPrompt = `Предложи ответ клиенту на последнее сообщение.\n\nКлиент: ${client?.name || "?"}, тел: ${client?.phone || "—"}\n`;
      if (meta?.avitoItemTitle) userPrompt += `Объявление Авито: ${meta.avitoItemTitle}, цена: ${meta.avitoPrice ?? "—"} ₽\n`;
      if (body.draftText) userPrompt += `Черновик оператора: ${body.draftText}\n`;
      userPrompt += `\nПереписка:\n${chatLog}\n\nНапиши только текст ответа клиенту.`;
    }

    try {
      const suggestion = await llmCompletion([
        { role: "system", text: SYSTEM_PROMPT },
        { role: "user", text: userPrompt },
      ]);
      return c.json({ suggestion, mode, provider: llmProvider(), model: llmModelLabel() }, 200);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка AI", 502, "ai_scan");
    }
  })
  .post("/hot-leads", async (c) => {
    if (!isLlmConfigured()) {
      return c.json({ error: "AI не настроен (AI_API_KEY + AI_BASE_URL или Yandex)" }, 503);
    }

    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(30, Math.max(5, Number(body.limit) || 15));

    const convs = await db
      .select({ conv: schema.conversations, client: schema.clients })
      .from(schema.conversations)
      .innerJoin(schema.clients, eq(schema.conversations.clientId, schema.clients.id))
      .where(and(forTenant(schema.conversations), eq(schema.conversations.status, "open")))
      .orderBy(desc(schema.conversations.lastMessageAt))
      .limit(limit);

    const leads: Array<{
      conversationId: number;
      clientName: string;
      channelType: string | null;
      lastMessageAt: string | null;
      score: number;
      reason: string;
      suggestedAction: string;
    }> = [];

    for (const { conv, client } of convs) {
      const messages = await db.select().from(schema.messages)
        .where(eq(schema.messages.conversationId, conv.id))
        .orderBy(asc(schema.messages.createdAt));
      const recent = messages.slice(-12);
      if (!recent.length) continue;

      const chatLog = recent.map((m) => {
        const who = m.senderType === "operator" ? "Оператор" : "Клиент";
        return `${who}: ${m.text || "[медиа]"}`;
      }).join("\n");

      const meta = parseConvMetadata(conv.metadata);
      const prompt = `Проанализируй переписку и оцени, насколько клиент «горячий» (готов купить запчасти или записаться на ремонт).
Клиент: ${client.name}, канал: ${conv.channelType || "?"}
${meta?.avitoItemTitle ? `Объявление: ${meta.avitoItemTitle}, цена ${meta.avitoPrice ?? "—"} ₽` : ""}

Переписка:
${chatLog}

Ответь СТРОГО в JSON без markdown:
{"score":0-100,"reason":"кратко почему","action":"что сделать оператору сейчас"}`;

      try {
        const raw = await llmCompletion([
          { role: "system", text: SYSTEM_PROMPT },
          { role: "user", text: prompt },
        ]);
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : null;
        const score = Number(parsed?.score) || 0;
        if (score < 40) continue;
        leads.push({
          conversationId: conv.id,
          clientName: client.name,
          channelType: conv.channelType,
          lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
          score,
          reason: String(parsed?.reason || "Интерес к покупке/ремонту"),
          suggestedAction: String(parsed?.action || "Связаться и уточнить детали"),
        });
      } catch {
        continue;
      }
    }

    leads.sort((a, b) => b.score - a.score);
    return c.json({ leads: leads.slice(0, 10) }, 200);
  })
  .get("/awd-items", (c) => c.json({ items: AWD_REPAIR_ITEMS }, 200))
  .post("/awd-quote", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const selectedIds = Array.isArray(body.selectedIds) ? body.selectedIds.map(String) : [];
    const vehicle = body.vehicle || {};
    const quote = calcAwdQuote(selectedIds);
    const text = formatAwdQuoteText(selectedIds, vehicle);

    let aiNote = "";
    if (isLlmConfigured() && selectedIds.length > 0) {
      try {
        aiNote = await llmCompletion([
          { role: "system", text: SYSTEM_PROMPT },
          { role: "user", text: `Составь короткий акт осмотра (3–5 пунктов) для ремонта полного привода по выбранным работам:\n${quote.items.map((i) => i.label).join("\n")}\nАвто: ${[vehicle.make, vehicle.model, vehicle.plate].filter(Boolean).join(" ") || "не указано"}` },
        ]);
      } catch { /* optional */ }
    }

    return c.json({ quote, text, inspectionNote: aiNote || null }, 200);
  })
  .get("/chat-opportunities", async (c) => {
    const q = (c.req.query("q") || "").trim().toLowerCase();
    const period = c.req.query("period") === "week" ? "week" : "today";
    const defaultLimit = period === "today" ? 150 : 50;
    const limit = Math.min(200, Math.max(10, Number(c.req.query("limit")) || defaultLimit));
    let opportunities = await scanChatOpportunities({ limit, period });
    if (q) {
      opportunities = opportunities.filter((o) =>
        o.clientName.toLowerCase().includes(q)
        || o.lastClientText.toLowerCase().includes(q)
        || (o.avitoItemTitle || "").toLowerCase().includes(q)
        || (o.reason || "").toLowerCase().includes(q),
      );
    }
    return c.json({ opportunities, count: opportunities.length, period }, 200);
  })
  .post("/scan", async (c) => {
    const drafts = await runAllScanners();
    const created = await persistProposals(drafts);
    const opportunities = await scanChatOpportunities({ period: "today", limit: 150 });
    return c.json({
      scanned: drafts.length,
      created,
      chatCount: opportunities.length,
      stages: ["inbox", "deal", "repair", "delivery", "parts"],
    }, 200);
  })
  .get("/proposals", async (c) => {
    const status = c.req.query("status") || "pending";
    const stage = c.req.query("stage");

    let rows = await db.select().from(schema.aiProposals)
      .where(forTenant(schema.aiProposals))
      .orderBy(desc(schema.aiProposals.priority), desc(schema.aiProposals.createdAt));

    if (status) rows = rows.filter((r) => r.status === status);
    if (stage) rows = rows.filter((r) => r.stage === stage);

    const enriched = await Promise.all(rows.map(async (p) => {
      let clientName: string | null = null;
      if (p.clientId) {
        const [cl] = await db.select().from(schema.clients).where(withTenant(schema.clients, eq(schema.clients.id, p.clientId)));
        clientName = cl?.name ?? null;
      }
      return { ...p, clientName, text: p.editedText || p.proposedText };
    }));

    return c.json({ proposals: enriched, count: enriched.length }, 200);
  })
  .patch("/proposals/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json().catch(() => ({}));
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (typeof body.editedText === "string") updates.editedText = body.editedText;
    if (body.status === "rejected") {
      updates.status = "rejected";
      updates.reviewedBy = c.get("userId");
    }

    const [proposal] = await db.update(schema.aiProposals)
      .set(updates)
      .where(withTenant(schema.aiProposals, eq(schema.aiProposals.id, id)))
      .returning();
    if (!proposal) return c.json({ error: "Не найдено" }, 404);
    return c.json({ proposal }, 200);
  })
  .post("/proposals/:id/approve", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const [proposal] = await db.select().from(schema.aiProposals)
      .where(withTenant(schema.aiProposals, eq(schema.aiProposals.id, id)));
    if (!proposal) return c.json({ error: "Не найдено" }, 404);
    if (proposal.status !== "pending") return c.json({ error: "Уже обработано" }, 400);

    const text = (proposal.editedText || proposal.proposedText).trim();
    if (!text) return c.json({ error: "Пустой текст" }, 400);

    if (!proposal.conversationId) {
      return c.json({ error: "Нет диалога для отправки — откройте чат вручную" }, 400);
    }

    try {
      await sendOutgoing(proposal.conversationId, text, userId);

      if (proposal.actionType === "appointment" && proposal.appointmentId) {
        await db.update(schema.serviceAppointments)
          .set({ status: "confirmed", updatedAt: new Date() })
          .where(withTenant(schema.serviceAppointments, eq(schema.serviceAppointments.id, proposal.appointmentId)));
      }

      const [updated] = await db.update(schema.aiProposals)
        .set({ status: "sent", reviewedBy: userId, sentAt: new Date(), updatedAt: new Date() })
        .where(withTenant(schema.aiProposals, eq(schema.aiProposals.id, id)))
        .returning();

      return c.json({ proposal: updated, ok: true }, 200);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка отправки", 502, "ai_send");
    }
  })
  .post("/proposals/:id/reject", async (c) => {
    const id = parseInt(c.req.param("id"));
    const [proposal] = await db.update(schema.aiProposals)
      .set({ status: "rejected", reviewedBy: c.get("userId"), updatedAt: new Date() })
      .where(and(withTenant(schema.aiProposals, eq(schema.aiProposals.id, id)), eq(schema.aiProposals.status, "pending")))
      .returning();
    if (!proposal) return c.json({ error: "Не найдено" }, 404);
    return c.json({ proposal }, 200);
  });
