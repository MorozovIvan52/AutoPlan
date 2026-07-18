import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, desc } from "drizzle-orm";
import { reconcileChannelUnread } from "../lib/unread-reconcile";
import { parseConfig, stringifyConfig } from "../lib/channel-config";
import { getAvitoToken, parseAvitoWebhook, fetchAvitoChat } from "../integrations/avito";
import { markAvitoConversationRead } from "../lib/avito-read";
import { ingestIncoming } from "./messaging";
import { broadcast } from "./ws";
import {
  extractAvitoItemFromChat,
  extractChatClient,
  getAvitoMessageRole,
  mergeAvitoMetadata,
  formatAvitoMessageText,
  isAvitoSystemMessageText,
  stripAvitoDecorations,
  isUnsupportedAvitoPlaceholder,
  isInvalidAvitoExternalId,
  isAvitoAccountLabel,
} from "../lib/avito-context";
import { shouldReplaceClientName, resolveAvitoClientName } from "../lib/client-enrich";
import { enrichClientOnMessage } from "../lib/client-enrich";
import { updateConversationPreview } from "../lib/conv-preview";

const AVITO_API = process.env.AVITO_API_BASE || "https://api.avito.ru";
const PROCESSED_IDS_MAX = 8_000;
const processedIds = new Set<string>();
const processedQueue: string[] = [];

function rememberProcessed(key: string) {
  if (processedIds.has(key)) return;
  processedIds.add(key);
  processedQueue.push(key);
  while (processedQueue.length > PROCESSED_IDS_MAX) {
    const old = processedQueue.shift();
    if (old) processedIds.delete(old);
  }
}

function log(...args: unknown[]) {
  console.log("[avito-poll]", ...args);
}

async function fetchJson(url: string, token: string) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`${res.status} ${t.slice(0, 200)}`);
  }
  return res.json() as Promise<any>;
}

function extractChats(data: any): any[] {
  return data?.chats ?? data?.result ?? (Array.isArray(data) ? data : []);
}

function chatSortKey(chat: any): number {
  const lm = chat.last_message ?? chat.lastMessage;
  const ts = lm?.created ?? chat.updated ?? chat.created ?? 0;
  return typeof ts === "number" ? ts : new Date(ts).getTime() / 1000 || 0;
}

function isUnreadChat(chat: any): boolean {
  return Boolean(chat.unread_count ?? chat.unreadCount ?? chat.is_unread ?? chat.isUnread);
}

function avitoMessageTime(msg: any): Date | undefined {
  const raw = msg.created ?? msg.created_at ?? msg.timestamp;
  if (raw == null) return undefined;
  if (typeof raw === "number") {
    return new Date(raw > 1e12 ? raw : raw * 1000);
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function resolveChatClient(
  channelSlug: string,
  chatId: string,
  chat: any,
  accountUserId: string,
): Promise<{ externalUserId: string; senderName: string } | null> {
  const fromChat = extractChatClient(chat, accountUserId);
  if (fromChat) return fromChat;

  const [conv] = await db.select().from(schema.conversations).where(
    and(
      eq(schema.conversations.externalChatId, chatId),
      eq(schema.conversations.channelType, channelSlug),
    ),
  ).limit(1);
  if (!conv) return null;

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, conv.clientId));
  if (!client?.externalId) return null;
  if (!isAvitoAccountLabel(client.name, undefined)) {
    return { externalUserId: client.externalId, senderName: client.name };
  }
  return null;
}

async function fetchChatsPage(
  userId: string,
  token: string,
  unreadOnly: boolean,
  offset: number,
): Promise<any[]> {
  const flag = unreadOnly ? "true" : "false";
  const urls = [
    `${AVITO_API}/messenger/v2/accounts/${userId}/chats?unread_only=${flag}&limit=100&offset=${offset}`,
    `${AVITO_API}/messenger/v2/accounts/${userId}/chats?unread_only=${flag}&limit=100`,
  ];
  for (const url of urls) {
    try {
      const data = await fetchJson(url, token);
      return extractChats(data);
    } catch {
      continue;
    }
  }
  return [];
}

async function fetchChatsPages(
  userId: string,
  token: string,
  unreadOnly: boolean,
  maxPages: number,
): Promise<any[]> {
  const chatMap = new Map<string, any>();
  for (let page = 0; page < maxPages; page++) {
    const offset = page * 100;
    const batch = await fetchChatsPage(userId, token, unreadOnly, offset);
    if (!batch.length) break;
    for (const c of batch) {
      const id = String(c.id ?? c.chat_id);
      if (id) chatMap.set(id, c);
    }
    if (batch.length < 100) break;
  }
  return [...chatMap.values()];
}

/** @deprecated используйте fetchChatsPages */
async function fetchAllChats(userId: string, token: string, unreadOnly: boolean): Promise<any[]> {
  const maxPages = unreadOnly ? 20 : 30;
  return fetchChatsPages(userId, token, unreadOnly, maxPages);
}

function extractMessages(data: any): any[] {
  return data?.messages ?? data?.result ?? (Array.isArray(data) ? data : []);
}

function messageSortTs(msg: any): number {
  const raw = msg.created ?? msg.created_at ?? msg.timestamp ?? 0;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  const d = new Date(raw).getTime();
  return Number.isNaN(d) ? 0 : d;
}

async function fetchMessagesPage(
  userId: string,
  chatId: string,
  token: string,
  limit: number,
  offset: number,
): Promise<any[]> {
  const urls = [
    `${AVITO_API}/messenger/v3/accounts/${userId}/chats/${chatId}/messages/?limit=${limit}&offset=${offset}`,
    `${AVITO_API}/messenger/v2/accounts/${userId}/chats/${chatId}/messages?limit=${limit}&offset=${offset}`,
    `${AVITO_API}/messenger/v3/accounts/${userId}/chats/${chatId}/messages/?limit=${limit}`,
    `${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/messages`,
  ];
  for (const url of urls) {
    try {
      const data = await fetchJson(url, token);
      const page = extractMessages(data);
      if (page.length) return page;
    } catch {
      continue;
    }
  }
  return [];
}

/** Загружает историю чата с ограничением (экономия памяти). */
async function fetchChatMessages(
  userId: string,
  chatId: string,
  token: string,
  maxMessages: number,
): Promise<any[]> {
  const byId = new Map<string, any>();
  const pageSize = 100;
  const maxPages = Math.max(1, Math.ceil(maxMessages / pageSize));

  for (let page = 0; page < maxPages; page++) {
    const offset = page * pageSize;
    const batch = await fetchMessagesPage(userId, chatId, token, pageSize, offset);
    if (!batch.length) break;
    let added = 0;
    for (const msg of batch) {
      const id = String(msg.id ?? msg.message_id ?? "");
      if (!id || byId.has(id)) continue;
      byId.set(id, msg);
      added++;
      if (byId.size >= maxMessages) break;
    }
    if (batch.length < pageSize || added === 0 || byId.size >= maxMessages) break;
  }

  return [...byId.values()].sort((a, b) => messageSortTs(a) - messageSortTs(b));
}

/** Полная история — только по кнопке «↻ Авито». */
async function fetchAllMessages(userId: string, chatId: string, token: string): Promise<any[]> {
  return fetchChatMessages(userId, chatId, token, 2000);
}

async function syncConversationAvitoMeta(
  channel: typeof schema.channels.$inferSelect,
  chat: any,
) {
  const chatId = String(chat.id ?? chat.chat_id);
  if (!chatId) return;

  const [conv] = await db.select().from(schema.conversations).where(
    and(
      eq(schema.conversations.externalChatId, chatId),
      eq(schema.conversations.channelType, channel.slug),
    ),
  ).limit(1);
  if (!conv) return;

  const item = extractAvitoItemFromChat(chat);
  const metadata = mergeAvitoMetadata(conv.metadata, {
    ...item,
    avitoAccountName: channel.name,
    avitoChannelId: channel.id,
  });

  const updates: Record<string, unknown> = { metadata };
  if (!conv.channelId) updates.channelId = channel.id;

  await db.update(schema.conversations).set(updates).where(eq(schema.conversations.id, conv.id));

  if (item.avitoItemTitle) {
    await enrichClientOnMessage(conv.clientId, {
      messageText: "",
      avitoItemTitle: item.avitoItemTitle,
    });
  }
}

async function syncChatClientIdentity(
  channel: typeof schema.channels.$inferSelect,
  chat: any,
  userId: string,
) {
  const chatId = String(chat.id ?? chat.chat_id);
  if (!chatId) return;

  let chatClient = extractChatClient(chat, userId);
  if (!chatClient || isAvitoAccountLabel(chatClient.senderName, channel.name)) {
    const config = parseConfig(channel.config);
    const chatData = await fetchAvitoChat(config, chatId);
    chatClient = chatData ? extractChatClient(chatData, userId) : null;
  }
  if (!chatClient || isInvalidAvitoExternalId(chatClient.externalUserId)) return;

  const displayName = resolveAvitoClientName({
    buyerName: chatClient.senderName,
    senderName: chatClient.senderName,
    accountName: channel.name,
  });
  if (displayName === "Клиент Авито") return;

  let [client] = await db.select().from(schema.clients).where(
    and(
      eq(schema.clients.externalId, chatClient.externalUserId),
      eq(schema.clients.source, channel.slug),
    ),
  ).limit(1);

  if (!client) {
    [client] = await db.insert(schema.clients).values({
      name: displayName,
      source: channel.slug,
      externalId: chatClient.externalUserId,
    }).returning();
  } else if (shouldReplaceClientName(client.name, displayName, channel.name)
    || isAvitoAccountLabel(client.name, channel.name)) {
    const prev = client.name;
    await db.update(schema.clients).set({
      name: displayName,
      updatedAt: new Date(),
    }).where(eq(schema.clients.id, client.id));
    client = { ...client, name: displayName };
    if (prev !== displayName) {
      log("имя клиента", chatId.slice(0, 16), prev, "→", displayName);
    }
  }

  const [conv] = await db.select().from(schema.conversations).where(
    and(
      eq(schema.conversations.externalChatId, chatId),
      eq(schema.conversations.channelType, channel.slug),
    ),
  ).limit(1);
  if (!conv) return;

  if (conv.clientId !== client.id) {
    await db.update(schema.conversations).set({ clientId: client.id }).where(eq(schema.conversations.id, conv.id));
    log("клиент чата", chatId.slice(0, 16), "→", displayName, `(id ${client.id})`);
  }
}

async function importMessage(
  channel: typeof schema.channels.$inferSelect,
  chat: any,
  msg: any,
  userId: string,
  countAsUnread: boolean,
): Promise<boolean> {
  const chatId = String(chat.id ?? chat.chat_id);
  const msgId = String(msg.id ?? msg.message_id ?? "");
  const dedupeKey = `${channel.slug}:${chatId}:${msgId}`;
  if (!msgId || processedIds.has(dedupeKey)) return false;

  const role = getAvitoMessageRole(msg, userId);
  if (!role) return false;

  const [exists] = await db.select().from(schema.messages)
    .where(eq(schema.messages.externalMessageId, msgId))
    .limit(1);
  if (exists) {
    const rawText = exists.text || msg.content?.text || msg.text || "";
    const shouldBeSystem = role === "system" || isAvitoSystemMessageText(rawText);
    if (shouldBeSystem && exists.senderType !== "system") {
      const fixedText = formatAvitoMessageText(rawText);
      await db.update(schema.messages).set({
        senderType: "system",
        text: fixedText,
      }).where(eq(schema.messages.id, exists.id));
      log("исправлен тип:", chatId.slice(0, 20), fixedText.slice(0, 50));
      exists.senderType = "system";
      exists.text = fixedText;
    } else if (exists.senderType === "client" && exists.text?.startsWith("ℹ️")) {
      const cleaned = stripAvitoDecorations(exists.text);
      if (cleaned !== exists.text) {
        await db.update(schema.messages).set({ text: cleaned }).where(eq(schema.messages.id, exists.id));
        exists.text = cleaned;
      }
    }
    const [conv] = await db.select().from(schema.conversations).where(
      and(
        eq(schema.conversations.externalChatId, chatId),
        eq(schema.conversations.channelType, channel.slug),
      ),
    ).limit(1);
    if (conv) await updateConversationPreview(conv.id, exists);
    rememberProcessed(dedupeKey);
    return false;
  }

  let chatClient = extractChatClient(chat, userId);
  if (!chatClient || isAvitoAccountLabel(chatClient.senderName, channel.name)) {
    const config = parseConfig(channel.config);
    const chatData = await fetchAvitoChat(config, chatId);
    chatClient = chatData ? extractChatClient(chatData, userId) : null;
  }

  const syntheticBody = {
    payload: {
      value: {
        ...msg,
        chat_id: chatId,
        author: msg.author ?? {
          id: msg.author_id ?? msg.user_id ?? userId,
          name: role === "operator"
            ? channel.name
            : (chatClient?.senderName || undefined),
        },
        content: msg.content ?? { text: msg.text ?? msg.body?.text },
        context: chat.context ?? chat.item ?? msg.context,
      },
    },
  };

  const parsed = parseAvitoWebhook(syntheticBody);
  if (!parsed) return false;

  let externalUserId = parsed.externalUserId;
  let senderName = parsed.senderName;

  if (chatClient && !isAvitoAccountLabel(chatClient.senderName, channel.name)) {
    externalUserId = chatClient.externalUserId;
    if (role !== "operator") senderName = chatClient.senderName;
  } else if (role === "client") {
    const authorName = parsed.senderName?.trim();
    if (authorName && !isAvitoAccountLabel(authorName, channel.name)) {
      senderName = authorName;
      if (!isInvalidAvitoExternalId(parsed.externalUserId) && parsed.externalUserId !== userId) {
        externalUserId = parsed.externalUserId;
      }
    }
  } else if (role === "operator" || role === "system") {
    const client = await resolveChatClient(channel.slug, chatId, chat, userId);
    if (!client) return false;
    externalUserId = client.externalUserId;
    senderName = client.senderName;
  }

  if (isInvalidAvitoExternalId(externalUserId)) return false;

  const chatItem = extractAvitoItemFromChat(chat);

  await ingestIncoming({
    channelId: channel.id,
    channelSlug: channel.slug,
    channelType: channel.type,
    externalUserId,
    externalChatId: parsed.externalChatId,
    senderName,
    buyerName: chatClient?.senderName,
    text: parsed.text,
    externalMessageId: parsed.externalMessageId,
    mediaUrl: parsed.mediaUrl,
    mediaType: parsed.mediaType,
    avitoItemId: parsed.avitoItemId ?? chatItem.avitoItemId,
    avitoItemTitle: parsed.avitoItemTitle ?? chatItem.avitoItemTitle,
    avitoPrice: parsed.avitoPrice ?? chatItem.avitoPrice,
    avitoItemUrl: parsed.avitoItemUrl ?? chatItem.avitoItemUrl,
    avitoAccountName: channel.name,
    senderType: role,
    countAsUnread: role === "client" ? countAsUnread : false,
    createdAt: avitoMessageTime(msg),
  });

  log(role === "operator" ? "наше:" : role === "system" ? "система:" : "новое:", parsed.externalChatId.slice(0, 20), parsed.text?.slice(0, 60));
  rememberProcessed(dedupeKey);
  return true;
}

async function processChat(
  channel: typeof schema.channels.$inferSelect,
  chat: any,
  userId: string,
  token: string,
  fullHistory: boolean,
  isUnread: boolean,
) {
  const chatId = String(chat.id ?? chat.chat_id);
  if (!chatId) return 0;

  await syncConversationAvitoMeta(channel, chat);
  await syncChatClientIdentity(channel, chat, userId);

  let imported = 0;
  const lastMsg = chat.last_message ?? chat.lastMessage;

  if (lastMsg && isUnsupportedAvitoPlaceholder(lastMsg)) {
    const messages = await fetchChatMessages(userId, chatId, token, 30);
    for (const msg of messages) {
      if (await importMessage(channel, chat, msg, userId, isUnread)) imported++;
    }
  } else if (lastMsg) {
    if (await importMessage(channel, chat, lastMsg, userId, isUnread)) imported++;
  }

  const syncAll = fullHistory || isUnread;
  if (!syncAll && imported > 0) return imported;

  if (syncAll) {
    const maxMessages = fullHistory ? 2000 : 50;
    const messages = await fetchChatMessages(userId, chatId, token, maxMessages);
    for (const msg of messages) {
      if (await importMessage(channel, chat, msg, userId, false)) imported++;
    }
  }

  return imported;
}

export async function syncAvitoUnreadCounts(
  channel: typeof schema.channels.$inferSelect,
  unreadChatIds: string[],
) {
  const unreadSet = new Set(unreadChatIds.filter(Boolean));

  const channelConvs = await db.select({
    id: schema.conversations.id,
    externalChatId: schema.conversations.externalChatId,
    unreadCount: schema.conversations.unreadCount,
    unreadPinned: schema.conversations.unreadPinned,
  })
    .from(schema.conversations)
    .where(eq(schema.conversations.channelType, channel.slug));

  for (const conv of channelConvs) {
    if (!conv.externalChatId || unreadSet.has(conv.externalChatId)) continue;
    if (conv.unreadPinned) continue;
    if ((conv.unreadCount || 0) > 0) {
      await db.update(schema.conversations).set({ unreadCount: 0 }).where(eq(schema.conversations.id, conv.id));
    }
  }

  for (const chatId of unreadSet) {
    const [conv] = await db.select().from(schema.conversations).where(and(
      eq(schema.conversations.channelType, channel.slug),
      eq(schema.conversations.externalChatId, chatId),
    )).limit(1);
    if (!conv) continue;
    if (conv.unreadPinned) continue;

    const [last] = await db.select().from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    if (last?.senderType === "operator") {
      await db.update(schema.conversations).set({ unreadCount: 0 }).where(eq(schema.conversations.id, conv.id));
      continue;
    }
    if (last?.senderType === "system" || isAvitoSystemMessageText(last?.text)) {
      await db.update(schema.conversations).set({ unreadCount: 0 }).where(eq(schema.conversations.id, conv.id));
      await markAvitoConversationRead(channel.id, channel.slug, chatId);
      continue;
    }

    if (last?.senderType === "client") {
      await db.update(schema.conversations)
        .set({ unreadCount: 1 })
        .where(eq(schema.conversations.id, conv.id));
    }
  }

  await reconcileChannelUnread(channel.slug);
}

async function pollAvitoChannelInternal(
  channel: typeof schema.channels.$inferSelect,
  opts: { fullHistoryForAll: boolean },
) {
  let config = parseConfig(channel.config);
  const { token, config: updated } = await getAvitoToken(config);
  if (updated.accessToken !== config.accessToken) {
    await db.update(schema.channels).set({ config: stringifyConfig(updated) }).where(eq(schema.channels.id, channel.id));
    config = updated;
  }

  const userId = String(config.userId!);
  const unreadPages = Number(process.env.AVITO_POLL_UNREAD_PAGES) || 10;
  const recentPages = Number(process.env.AVITO_POLL_RECENT_PAGES) || 2;

  let unreadChats = await fetchChatsPages(userId, token, true, unreadPages);
  let recentChats = opts.fullHistoryForAll
    ? await fetchChatsPages(userId, token, false, 30)
    : await fetchChatsPages(userId, token, false, recentPages);

  if (!unreadChats.length && !recentChats.length) {
    log("API не вернул чаты — пропускаем цикл (счётчики не трогаем)");
    return;
  }

  const chatMap = new Map<string, any>();
  for (const c of unreadChats) {
    const id = String(c.id ?? c.chat_id);
    if (id) chatMap.set(id, c);
  }
  for (const c of recentChats) {
    const id = String(c.id ?? c.chat_id);
    if (id && !chatMap.has(id)) chatMap.set(id, c);
  }

  const unreadIds = new Set(unreadChats.map((c) => String(c.id ?? c.chat_id)));
  const chats = [...chatMap.values()].sort((a, b) => {
    const aUnread = unreadIds.has(String(a.id ?? a.chat_id)) ? 1 : 0;
    const bUnread = unreadIds.has(String(b.id ?? b.chat_id)) ? 1 : 0;
    if (aUnread !== bUnread) return bUnread - aUnread;
    return chatSortKey(b) - chatSortKey(a);
  });

  log(`чатов: ${chats.length} (непрочитанных: ${unreadChats.length})`);

  const unreadList = chats.filter((c) => {
    const id = String(c.id ?? c.chat_id);
    return unreadIds.has(id) || isUnreadChat(c);
  });
  const recentOnly = chats.filter((c) => {
    const id = String(c.id ?? c.chat_id);
    return !unreadIds.has(id) && !isUnreadChat(c);
  });
  const maxRecent = opts.fullHistoryForAll
    ? recentOnly.length
    : Number(process.env.AVITO_POLL_MAX_RECENT) || 40;
  const toProcess = [...unreadList, ...recentOnly.slice(0, maxRecent)];

  let totalImported = 0;
  let processed = 0;

  for (const chat of toProcess) {
    const chatId = String(chat.id ?? chat.chat_id);
    const isUnread = unreadIds.has(chatId) || isUnreadChat(chat);
    const fullHistory = opts.fullHistoryForAll || isUnread;

    try {
      totalImported += await processChat(channel, chat, userId, token, fullHistory, isUnread);
    } catch (e: any) {
      log(`ошибка чата ${chat.id}:`, e.message);
    }
    processed++;
    if (processed % 8 === 0) await new Promise((r) => setTimeout(r, 50));
  }

  if (recentOnly.length > maxRecent && !opts.fullHistoryForAll) {
    log(`непрочитанных: ${unreadList.length}, свежих: ${maxRecent} из ${recentOnly.length}`);
  }

  if (totalImported > 0) {
    log(`импортировано сообщений: ${totalImported}`);
    broadcast({ type: "inbox_refresh", channel: channel.slug, imported: totalImported });
  }

  await syncAvitoUnreadCounts(channel, [...unreadIds]);
  if (unreadIds.size > 0) {
    log(`непрочитанных на Авито: ${unreadIds.size}`);
  }

  await db.update(schema.channels).set({ lastSyncAt: new Date() }).where(eq(schema.channels.id, channel.id));
  return { imported: totalImported, chats: chats.length };
}

/** Обычный цикл: полная история для непрочитанных и существующих диалогов. */
export async function pollAvitoChannel(channel: typeof schema.channels.$inferSelect) {
  return pollAvitoChannelInternal(channel, { fullHistoryForAll: false });
}

/** Полная подгрузка всех чатов и сообщений (кнопка «↻ Авито» / первый запуск). */
export async function syncAvitoChannelFull(channel: typeof schema.channels.$inferSelect) {
  log(`полная синхронизация: ${channel.name}`);
  return pollAvitoChannelInternal(channel, { fullHistoryForAll: true });
}

export function startAvitoPolling() {
  const isProd = process.env.NODE_ENV === "production";
  const envFlag = process.env.AVITO_POLL_ENABLED;

  if (envFlag === "false") {
    console.log("[avito-poll] отключён (AVITO_POLL_ENABLED=false)");
    return;
  }
  if (!isProd && envFlag !== "true") {
    console.log("[avito-poll] отключён (dev — задайте AVITO_POLL_ENABLED=true)");
    return;
  }

  const rawInterval = Number(process.env.AVITO_POLL_INTERVAL_SECONDS) || (isProd ? 90 : 8);
  const intervalSec = isProd ? Math.max(90, rawInterval) : rawInterval;
  console.log(`[avito-poll] запущен, интервал ${intervalSec}с${isProd ? " (резерв к webhook)" : ""}`);

  let pollRunning = false;

  const tick = async () => {
    if (pollRunning) {
      log("пропуск цикла — предыдущий ещё выполняется");
      return;
    }
    pollRunning = true;
    try {
      const channels = await db.select().from(schema.channels).where(
        and(eq(schema.channels.type, "avito"), eq(schema.channels.isActive, true)),
      );
      if (channels.length === 0) {
        log("нет активных каналов Авито — проверьте Настройки → Каналы");
        return;
      }
      for (let i = 0; i < channels.length; i++) {
        await pollAvitoChannel(channels[i]);
        if (i < channels.length - 1) await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (e: any) {
      console.error("[avito-poll] ошибка:", e.message);
    } finally {
      pollRunning = false;
    }
  };

  tick();
  setInterval(tick, intervalSec * 1000);
}
