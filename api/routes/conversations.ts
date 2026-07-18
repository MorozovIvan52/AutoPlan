import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, sql, desc, inArray, and, gt, ne, isNull } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { sendOutgoing, deleteConversationMessage } from "../services/messaging";
import { saveUpload, resolveUploadPath } from "../lib/uploads";
import { normalizeUploadFilename } from "../lib/media";
import { mediaTypeFromUrl } from "../lib/template-media";
import { parseConfig, stringifyConfig } from "../lib/channel-config";
import { markAvitoChatRead } from "../integrations/avito";
import { clearConversationUnread, pinConversationUnread } from "../lib/conversation-unread";
import { resolveMessageMedia, mediaDownloadName } from "../lib/message-media";
import { searchConversationIds, attachSearchHits } from "../lib/chat-search";
import { trackActivityEvent } from "../lib/activity-track";
import { backfillMessageOcr } from "../lib/message-ocr";
import { getDemoClientIds, isDemoUser, assertDemoClientAccess } from "../lib/demo-mode";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getConversationInTenant, getClientInTenant } from "../lib/tenant-guard";
import { jsonApiError } from "../lib/api-error";

export const conversations = new Hono()
  .use("*", requireAuth)
  .get("/", async (c) => {
    const status = c.req.query("status");
    const assignedTo = c.req.query("assignedTo");
    const channelType = c.req.query("channelType");
    const unreadOnly = c.req.query("unreadOnly") === "true";
    const search = c.req.query("search") || "";
    const limit = Math.min(200, Math.max(1, parseInt(c.req.query("limit") || "80", 10) || 80));

    const user = c.get("user") as { role?: string };
    const conditions = [forTenant(schema.conversations)];
    if (isDemoUser(user)) {
      const demoIds = await getDemoClientIds();
      if (!demoIds.length) return c.json({ conversations: [], searchQuery: search, unreadTotal: 0 }, 200);
      conditions.push(inArray(schema.conversations.clientId, demoIds));
    }
    if (status) conditions.push(eq(schema.conversations.status, status as "open" | "pending" | "closed"));
    if (assignedTo) conditions.push(eq(schema.conversations.assignedTo, parseInt(assignedTo, 10)));
    if (unreadOnly) conditions.push(gt(schema.conversations.unreadCount, 0));
    if (channelType) conditions.push(eq(schema.conversations.channelType, channelType));

    const searchHits = search.trim().length >= 2 ? await searchConversationIds(search) : null;
    if (searchHits && searchHits.size > 0) {
      conditions.push(inArray(schema.conversations.id, [...searchHits.keys()]));
    } else if (search.trim().length >= 2) {
      return c.json({ conversations: [], searchQuery: search, unreadTotal: 0 }, 200);
    } else if (search.trim()) {
      const q = `%${search.trim().replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
      conditions.push(sql`(
        ${schema.clients.name} LIKE ${q} ESCAPE '\\'
        OR COALESCE(${schema.clients.phone}, '') LIKE ${q} ESCAPE '\\'
      )`);
    }

    const whereClause = conditions.length ? and(...conditions) : undefined;

    let query = db
      .select({ conv: schema.conversations, client: schema.clients })
      .from(schema.conversations)
      .innerJoin(schema.clients, eq(schema.conversations.clientId, schema.clients.id))
      .orderBy(
        sql`CASE WHEN ${schema.conversations.pinnedAt} IS NOT NULL THEN 0 ELSE 1 END`,
        desc(schema.conversations.pinnedAt),
        desc(schema.conversations.lastMessageAt),
      )
      .limit(limit);

    if (whereClause) query = query.where(whereClause) as typeof query;

    const convs = await query;

    const unreadConditions = [forTenant(schema.conversations), gt(schema.conversations.unreadCount, 0)];
    if (isDemoUser(user)) {
      unreadConditions.push(inArray(schema.conversations.clientId, await getDemoClientIds()));
    }
    const unreadRow = await db
      .select({ total: sql<number>`COALESCE(SUM(${schema.conversations.unreadCount}), 0)` })
      .from(schema.conversations)
      .where(and(...unreadConditions));
    const unreadTotal = Number(unreadRow[0]?.total ?? 0);

    const clientIds = [...new Set(convs.map((x) => x.client.id))];
    let tagsData: { clientId: number; tag: typeof schema.tags.$inferSelect }[] = [];
    if (clientIds.length > 0) {
      tagsData = await db
        .select({ clientId: schema.clientTags.clientId, tag: schema.tags })
        .from(schema.clientTags)
        .innerJoin(schema.tags, eq(schema.clientTags.tagId, schema.tags.id))
        .where(inArray(schema.clientTags.clientId, clientIds));
    }

    const channelIds = [...new Set(convs.map((x) => x.conv.channelId).filter((id): id is number => id != null))];
    const channelsById = new Map<number, typeof schema.channels.$inferSelect>();
    if (channelIds.length > 0) {
      const chRows = await db.select().from(schema.channels).where(inArray(schema.channels.id, channelIds));
      for (const ch of chRows) channelsById.set(ch.id, ch);
    }

    const tagsByClient = new Map<number, (typeof schema.tags.$inferSelect)[]>();
    for (const t of tagsData) {
      const list = tagsByClient.get(t.clientId) || [];
      list.push(t.tag);
      tagsByClient.set(t.clientId, list);
    }

    const openChannelCounts = new Map<string, number>();
    const clientAvitoAccountsMap = new Map<number, { channelType: string; slug: string; name: string; openCount: number }[]>();
    const avitoNameBySlug = new Map<string, string>();

    if (clientIds.length > 0) {
      const openRows = await db
        .select({
          clientId: schema.conversations.clientId,
          channelType: schema.conversations.channelType,
          cnt: sql<number>`count(*)`,
        })
        .from(schema.conversations)
        .where(and(
          eq(schema.conversations.status, "open"),
          inArray(schema.conversations.clientId, clientIds),
        ))
        .groupBy(schema.conversations.clientId, schema.conversations.channelType);

      const needsAvito = openRows.some((r) => (r.channelType || "").startsWith("avito"));
      if (needsAvito) {
        const avitoChannelRows = await db
          .select({ slug: schema.channels.slug, name: schema.channels.name })
          .from(schema.channels)
          .where(eq(schema.channels.type, "avito"));
        for (const ch of avitoChannelRows) avitoNameBySlug.set(ch.slug, ch.name);
      }

      for (const row of openRows) {
        const key = `${row.clientId}:${row.channelType || ""}`;
        openChannelCounts.set(key, Number(row.cnt) || 0);

        const chType = row.channelType || "";
        if (!chType.startsWith("avito")) continue;
        const openCount = Number(row.cnt) || 0;
        const slug = chType;
        const name = avitoNameBySlug.get(slug) || slug;
        const list = clientAvitoAccountsMap.get(row.clientId) || [];
        list.push({ channelType: chType, slug, name, openCount });
        clientAvitoAccountsMap.set(row.clientId, list);
      }

      for (const [, list] of clientAvitoAccountsMap) {
        list.sort((a, b) => a.slug.localeCompare(b.slug, undefined, { numeric: true }));
      }
    }

    let result = convs.map(({ conv, client }) => {
      const channel = conv.channelId ? channelsById.get(conv.channelId) : null;
      const openChannelConvCount = openChannelCounts.get(`${client.id}:${conv.channelType || ""}`) || 1;
      const clientOpenAvitoAccounts = clientAvitoAccountsMap.get(client.id) || [];
      const clientOpenAvitoTotal = clientOpenAvitoAccounts.reduce((s, a) => s + a.openCount, 0);
      const lastMessage = conv.lastMessageId ? {
        id: conv.lastMessageId,
        text: conv.lastMessageText,
        senderType: conv.lastMessageSenderType,
        createdAt: conv.lastMessageAt,
      } : null;
      return {
        ...conv,
        openChannelConvCount,
        clientOpenAvitoAccounts,
        clientOpenAvitoTotal,
        channel: channel ? { id: channel.id, name: channel.name, type: channel.type, slug: channel.slug } : null,
        client: {
          ...client,
          tags: tagsByClient.get(client.id) || [],
        },
        lastMessage,
      };
    });

    if (searchHits) {
      result = attachSearchHits(result, searchHits);
    }

    return c.json({ conversations: result, searchQuery: search || undefined, unreadTotal }, 200);
  })
  .post("/ocr-index", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (user?.role !== "admin") return c.json({ error: "Только для администратора" }, 403);
    const body = await c.req.json().catch(() => ({}));
    const limit = Math.min(200, Number(body.limit) || 50);
    const result = await backfillMessageOcr(limit);
    return c.json(result, 200);
  })
  .post("/", async (c) => {
    const body = await c.req.json();
    const client = await getClientInTenant(Number(body.clientId));
    if (!client) return c.json({ error: "Клиент не найден" }, 404);
    const [conv] = await db.insert(schema.conversations).values({
      clientId: body.clientId,
      channelType: body.channelType || "manual",
      channelId: body.channelId,
      externalChatId: body.externalChatId,
      status: "open",
      assignedTo: body.assignedTo,
      lastMessageAt: new Date(),
      tenantId: tenantId(),
    }).returning();
    return c.json({ conversation: conv }, 201);
  })
  .get("/:id/messages", async (c) => {
    const convId = parseInt(c.req.param("id"));
    const conv = await getConversationInTenant(convId);
    if (!conv) return c.json({ error: "Not found" }, 404);
    const user = c.get("user") as { role?: string };
    if (!(await assertDemoClientAccess(user, conv.clientId))) return c.json({ error: "Not found" }, 404);

    const limit = Math.min(150, Math.max(20, parseInt(c.req.query("limit") || "80", 10) || 80));
    const beforeId = parseInt(c.req.query("before") || "0", 10);

    let rows = await db.select().from(schema.messages)
      .where(eq(schema.messages.conversationId, convId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(limit + 1);

    if (beforeId > 0) {
      const [anchor] = await db.select().from(schema.messages).where(eq(schema.messages.id, beforeId));
      if (anchor && anchor.conversationId === convId) {
        rows = await db.select().from(schema.messages)
          .where(and(
            eq(schema.messages.conversationId, convId),
            sql`(${schema.messages.createdAt} < ${anchor.createdAt} OR (${schema.messages.createdAt} = ${anchor.createdAt} AND ${schema.messages.id} < ${anchor.id}))`,
          ))
          .orderBy(desc(schema.messages.createdAt))
          .limit(limit + 1);
      }
    }

    const hasMore = rows.length > limit;
    let page = (hasMore ? rows.slice(0, limit) : rows).reverse();

    const viewer = c.get("user") as { role?: string } | undefined;
    if (viewer?.role === "admin") {
      const senderIds = [...new Set(
        page.map((m) => m.senderId).filter((id): id is number => id != null),
      )];
      const nameById = new Map<number, string>();
      if (senderIds.length) {
        const senders = await db.select({ id: schema.users.id, name: schema.users.name })
          .from(schema.users)
          .where(inArray(schema.users.id, senderIds));
        for (const s of senders) nameById.set(s.id, s.name);
      }
      page = page.map((m) => {
        if (m.senderType !== "operator" || !m.senderId) return m;
        return { ...m, senderName: nameById.get(m.senderId) || `Оператор #${m.senderId}` };
      });
    }

    const avitoFileNotice = "📎 Клиент приложил файл — API Авито не передаёт содержимое. Откройте диалог в приложении Авито или попросите отправить фото/PDF в WhatsApp.";
    const avitoVoiceNotice = "🎤 Голосовое сообщение (откройте чат в приложении Авито)";
    for (const m of page) {
      if (m.text === "[файл]" && !m.mediaUrl) {
        m.text = avitoFileNotice;
      }
      if ((m.text === "[голосовое]" || m.text === avitoVoiceNotice) && !m.mediaUrl && m.externalMessageId) {
        m.mediaUrl = `avito:voice:${m.externalMessageId}`;
        if (m.text === avitoVoiceNotice) m.text = "[голосовое]";
      }
    }

    return c.json({ messages: page, hasMore }, 200);
  })
  .get("/:id/messages/:msgId/media", async (c) => {
    const convId = parseInt(c.req.param("id"));
    const msgId = parseInt(c.req.param("msgId"));
    const download = c.req.query("download") === "1";

    const conv = await getConversationInTenant(convId);
    if (!conv) return c.json({ error: "Not found" }, 404);

    let [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, msgId));
    if (!msg || msg.conversationId !== convId) return c.json({ error: "Not found" }, 404);
    if (!msg.mediaUrl) {
      const isVoice = msg.text === "[голосовое]" || msg.text?.includes("Голосовое сообщение");
      if (isVoice && msg.externalMessageId) {
        msg = { ...msg, mediaUrl: `avito:voice:${msg.externalMessageId}` };
      } else {
        return c.json({ error: "Нет медиа" }, 404);
      }
    }

    const resolved = await resolveMessageMedia(msg, conv);
    if (!resolved) return c.json({ error: "Файл недоступен" }, 404);

    const filename = mediaDownloadName(msg, resolved.mime);
    const headers: Record<string, string> = {
      "Content-Type": resolved.mime,
      "Cache-Control": "private, max-age=3600",
    };
    if (download) {
      const ascii = filename.replace(/[^\x20-\x7E]/g, "_");
      headers["Content-Disposition"] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
    }

    return new Response(new Uint8Array(resolved.buffer), { headers });
  })
  .get("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const conv = await getConversationInTenant(id);
    if (!conv) return c.json({ error: "Not found" }, 404);
    const user = c.get("user") as { role?: string };
    if (!(await assertDemoClientAccess(user, conv.clientId))) return c.json({ error: "Not found" }, 404);
    const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, conv.clientId));
    const vehiclesData = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, conv.clientId));
    let channel = null;
    if (conv.channelId) {
      const [ch] = await db.select().from(schema.channels).where(eq(schema.channels.id, conv.channelId));
      if (ch) channel = { id: ch.id, name: ch.name, type: ch.type, slug: ch.slug };
    }

    const siblingChannelFilter = conv.channelType
      ? eq(schema.conversations.channelType, conv.channelType)
      : isNull(schema.conversations.channelType);

    const siblingRows = await db.select({
      id: schema.conversations.id,
      externalChatId: schema.conversations.externalChatId,
      metadata: schema.conversations.metadata,
      lastMessageText: schema.conversations.lastMessageText,
    }).from(schema.conversations).where(and(
      eq(schema.conversations.clientId, conv.clientId),
      siblingChannelFilter,
      ne(schema.conversations.id, conv.id),
      eq(schema.conversations.status, "open"),
    ));

    return c.json({
      conversation: {
        ...conv,
        lastMessage: conv.lastMessageId ? {
          id: conv.lastMessageId,
          text: conv.lastMessageText,
          senderType: conv.lastMessageSenderType,
          createdAt: conv.lastMessageAt,
        } : null,
        client: client ? { ...client, vehicles: vehiclesData } : null,
        channel,
        siblingConversations: siblingRows,
      },
    }, 200);
  })
  .patch("/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const patch: Record<string, unknown> = {};
    if (body.status != null) patch.status = body.status;
    if (body.assignedTo != null) patch.assignedTo = body.assignedTo;
    if (body.pinned === true) patch.pinnedAt = new Date();
    if (body.pinned === false) patch.pinnedAt = null;
    const [conv] = await db.update(schema.conversations).set(patch)
      .where(withTenant(schema.conversations, eq(schema.conversations.id, id)))
      .returning();
    if (!conv) return c.json({ error: "Not found" }, 404);
    if (body.assignedTo) {
      const operatorId = c.get("userId") as number;
      await db.insert(schema.notifications).values({
        userId: body.assignedTo,
        type: "assigned",
        title: "Вам назначен диалог",
        text: `Диалог #${id}`,
        link: "/",
        tenantId: tenantId(),
      });
      void trackActivityEvent(Number(body.assignedTo), "chat_assigned", "conversation", id, { by: operatorId });
    }
    return c.json({ conversation: conv }, 200);
  })
  .post("/:id/read", async (c) => {
    const convId = parseInt(c.req.param("id"));
    const conv = await getConversationInTenant(convId);
    if (!conv) return c.json({ error: "Not found" }, 404);

    await clearConversationUnread(convId);

    if (conv.externalChatId && conv.channelId) {
      const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, conv.channelId));
      if (channel?.type === "avito") {
        let config = parseConfig(channel.config);
        const result = await markAvitoChatRead(config, conv.externalChatId);
        if (result.config) {
          await db.update(schema.channels)
            .set({ config: stringifyConfig(result.config) })
            .where(eq(schema.channels.id, channel.id));
        }
      }
    }

    return c.json({ ok: true }, 200);
  })
  .post("/:id/unread", async (c) => {
    const convId = parseInt(c.req.param("id"));
    if (!Number.isFinite(convId)) return c.json({ error: "Некорректный id" }, 400);

    try {
      const { unreadCount } = await pinConversationUnread(convId);
      return c.json({ ok: true, unreadCount }, 200);
    } catch (e: unknown) {
      if (e instanceof Error && e.message === "Диалог не найден") return c.json({ error: "Not found" }, 404);
      return jsonApiError(c, e, "Ошибка", 400, "conv_pin_unread");
    }
  })
  .post("/:id/messages", async (c) => {
    const convId = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;

    let text = "";
    let mediaUrl: string | undefined;
    let mediaType: "photo" | "video" | "document" | undefined;

    const ctype = c.req.header("content-type") || "";
    if (ctype.includes("multipart/form-data")) {
      const body = await c.req.parseBody();
      const file = body.file ?? body.image ?? body.video ?? body.document;
      text = typeof body.text === "string" ? body.text : "";
      if (file && typeof file !== "string") {
        const f = file as File;
        const buffer = Buffer.from(await f.arrayBuffer());
        const saved = saveUpload(buffer, normalizeUploadFilename(f.name || "", f.type), f.type);
        mediaUrl = saved.url;
        mediaType = saved.mediaType;
      }
    } else {
      const body = await c.req.json();
      text = body.text || "";
      mediaUrl = body.mediaUrl;
      if (body.mediaType === "photo" || body.mediaType === "video" || body.mediaType === "document") {
        mediaType = body.mediaType;
      }
      if (mediaUrl) {
        const file = resolveUploadPath(mediaUrl);
        if (file) mediaType = file.mediaType;
        else if (!mediaType) mediaType = mediaTypeFromUrl(mediaUrl);
      }
    }

    try {
      const result = await sendOutgoing(convId, text, userId || undefined, { mediaUrl, mediaType });
      return c.json(result, 201);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка отправки", 400, "conv_send");
    }
  })
  .delete("/:id/messages/:msgId", async (c) => {
    const convId = parseInt(c.req.param("id"));
    const msgId = parseInt(c.req.param("msgId"));
    const userId = c.get("userId") as number;

    if (!Number.isFinite(convId) || !Number.isFinite(msgId)) {
      return c.json({ error: "Некорректный id" }, 400);
    }

    try {
      const result = await deleteConversationMessage(convId, msgId, userId);
      return c.json(result, 200);
    } catch (e: any) {
      return jsonApiError(c, e, "Не удалось удалить сообщение", 400, "conv_delete_msg");
    }
  });
