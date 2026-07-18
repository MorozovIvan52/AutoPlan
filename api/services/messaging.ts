import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, desc, gte } from "drizzle-orm";
import { parseConfig, stringifyConfig } from "../lib/channel-config";
import { sendChannelMessage } from "../integrations";
import { broadcast } from "./ws";
import { trackActivityEvent } from "../lib/activity-track";
import { mergeAvitoMetadata, isAvitoOrderSystemText, isAvitoSystemMessageText, isInvalidAvitoExternalId, formatAvitoMessageText, stripAvitoDecorations, isAvitoOfferInterestSystemText, AVITO_OFFER_INTEREST_AUTO_REPLY, isAvitoAccountLabel } from "../lib/avito-context";
import { isGenericClientName, resolveAvitoClientName, shouldReplaceClientName } from "../lib/client-enrich";
import { enrichClientOnMessage } from "../lib/client-enrich";
import { mediaPlaceholder, type MediaKind } from "../lib/media";
import { mediaTypeFromUrl } from "../lib/template-media";
import { parseTelegramFileId, downloadTelegramFile } from "../lib/telegram-media";
import { parseWhatsAppMediaId, downloadWhatsAppMedia } from "../lib/whatsapp-media";
import { cacheHttpMedia } from "../lib/remote-media";
import { saveUpload, resolveUploadPath } from "../lib/uploads";
import { maybeCreateAutoDealFromMessage } from "../lib/auto-deals";
import { notifyUser } from "../lib/notify";
import { sendAvitoMessage, verifyAvitoMessageDelivered, deleteAvitoMessage } from "../integrations/avito";
import { markAvitoConversationRead } from "../lib/avito-read";
import { repairConversationPreviews } from "../lib/conv-preview-audit";
import {
  initialDeliveryStatus,
  markOperatorMessagesReadBefore,
} from "../lib/message-delivery";
import { previewPatchFromMessage, updateConversationPreview } from "../lib/conv-preview";
import { scheduleMessageOcr } from "../lib/message-ocr";
import { clearConversationSlaAlerts } from "../lib/conversation-sla-alerts";
import { tenantId, forTenant } from "../lib/tenant-query";

export type IncomingMessage = {
  channelId?: number;
  channelSlug: string;
  channelType: string;
  externalUserId: string;
  externalChatId: string;
  senderName: string;
  text: string;
  externalMessageId?: string;
  mediaUrl?: string;
  mediaType?: string;
  phone?: string;
  avitoItemId?: string;
  avitoItemTitle?: string;
  avitoPrice?: number;
  avitoItemUrl?: string;
  avitoAccountName?: string;
  /** Имя покупателя из чата Авито (interlocutor), не имя аккаунта продавца */
  buyerName?: string;
  /** false = импорт истории без увеличения счётчика непрочитанных */
  countAsUnread?: boolean;
  /** client = от покупателя, operator = наше, system = уведомление Авито */
  senderType?: "client" | "operator" | "system";
  createdAt?: Date;
};

/** Не дублировать сообщение, если оно уже сохранено (отправка из CRM + webhook/poll). */
async function findExistingMessage(
  conversationId: number,
  externalMessageId?: string,
  opts?: { text?: string; senderType?: string; withinMs?: number },
) {
  if (externalMessageId) {
    const [byExt] = await db.select().from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.externalMessageId, externalMessageId),
      ))
      .limit(1);
    if (byExt) return byExt;
  }

  const text = opts?.text?.trim();
  if (text && opts?.senderType) {
    const since = new Date(Date.now() - (opts.withinMs ?? 30_000));
    const [recent] = await db.select().from(schema.messages)
      .where(and(
        eq(schema.messages.conversationId, conversationId),
        eq(schema.messages.senderType, opts.senderType as "client" | "operator" | "system"),
        eq(schema.messages.text, text),
        gte(schema.messages.createdAt, since),
      ))
      .orderBy(desc(schema.messages.createdAt))
      .limit(1);
    if (recent) return recent;
  }

  return null;
}

async function maybeAutoReplyAvitoOfferInterest(conversationId: number, triggerAt: Date) {
  const [operatorAfter] = await db.select().from(schema.messages)
    .where(and(
      eq(schema.messages.conversationId, conversationId),
      eq(schema.messages.senderType, "operator"),
      gte(schema.messages.createdAt, triggerAt),
    ))
    .limit(1);
  if (operatorAfter) return;

  await sendOutgoing(conversationId, AVITO_OFFER_INTEREST_AUTO_REPLY);
  console.log(`[avito/auto-reply] «заинтересовалось предложение» → диалог ${conversationId}`);
}

export async function ingestIncoming(msg: IncomingMessage) {
  let senderType = msg.senderType ?? "client";
  if (senderType === "client" && isAvitoSystemMessageText(msg.text)) {
    senderType = "system";
  }
  const isOperator = senderType === "operator";
  const isSystem = senderType === "system";
  const countAsUnread = !isOperator && (
    isSystem ? msg.countAsUnread === true : msg.countAsUnread !== false
  );
  const isAvito = msg.channelType === "avito" || msg.channelSlug.startsWith("avito");

  let [conv] = await db.select().from(schema.conversations).where(
    and(
      eq(schema.conversations.externalChatId, msg.externalChatId),
      eq(schema.conversations.channelType, msg.channelSlug),
    ),
  );

  let externalUserId = msg.externalUserId;
  if (isAvito && isInvalidAvitoExternalId(externalUserId) && conv) {
    const [convClient] = await db.select().from(schema.clients).where(eq(schema.clients.id, conv.clientId));
    if (convClient?.externalId && !isInvalidAvitoExternalId(convClient.externalId)) {
      externalUserId = convClient.externalId;
    }
  }

  if (isAvito && isInvalidAvitoExternalId(externalUserId)) {
    console.warn("[ingest] пропуск: нет ID покупателя Авито для чата", msg.externalChatId);
    return null;
  }

  let [client] = await db.select().from(schema.clients).where(
    and(
      forTenant(schema.clients),
      eq(schema.clients.externalId, externalUserId),
      eq(schema.clients.source, msg.channelSlug),
    ),
  );

  const displayName = isAvito
    ? resolveAvitoClientName({
      buyerName: msg.buyerName,
      senderName: msg.senderName,
      accountName: msg.avitoAccountName,
    })
    : (msg.senderName?.trim() || "Клиент");

  if (!client) {
    [client] = await db.insert(schema.clients).values({
      name: displayName,
      source: msg.channelSlug,
      externalId: externalUserId,
      phone: msg.phone,
      tenantId: tenantId(),
    }).returning();
  } else if (
    shouldReplaceClientName(client.name, displayName, msg.avitoAccountName)
    || (isAvito && isAvitoAccountLabel(client.name, msg.avitoAccountName) && displayName !== "Клиент Авито")
  ) {
    await db.update(schema.clients).set({ name: displayName, updatedAt: new Date() }).where(eq(schema.clients.id, client.id));
    client = { ...client, name: displayName };
  } else if (!isAvito && msg.senderName && shouldReplaceClientName(client.name, msg.senderName)) {
    await db.update(schema.clients).set({ name: msg.senderName, updatedAt: new Date() }).where(eq(schema.clients.id, client.id));
    client = { ...client, name: msg.senderName };
  }

  const metadataPatch = isAvito ? {
    avitoItemId: msg.avitoItemId,
    avitoItemTitle: msg.avitoItemTitle,
    avitoPrice: msg.avitoPrice,
    avitoItemUrl: msg.avitoItemUrl,
    avitoAccountName: msg.avitoAccountName,
    avitoChannelId: msg.channelId,
  } : {};
  const metadata = isAvito
    ? mergeAvitoMetadata(undefined, metadataPatch)
    : undefined;

  const msgTime = msg.createdAt ?? new Date();

  if (!conv) {
    [conv] = await db.insert(schema.conversations).values({
      clientId: client.id,
      channelId: msg.channelId,
      channelType: msg.channelSlug,
      externalChatId: msg.externalChatId,
      status: "open",
      lastMessageAt: msgTime,
      unreadCount: countAsUnread ? 1 : 0,
      metadata,
      tenantId: tenantId(),
    }).returning();
  } else {
    const lastAt = conv.lastMessageAt && msg.createdAt
      ? (new Date(conv.lastMessageAt) > msgTime ? new Date(conv.lastMessageAt) : msgTime)
      : msgTime;
    const updates: Record<string, unknown> = { lastMessageAt: lastAt };
    if (isOperator) {
      updates.unreadCount = 0;
      updates.unreadPinned = false;
      updates.slaWarnedAt = null;
      updates.slaDangerNotifiedAt = null;
    } else if (isSystem) {
      updates.unreadCount = 0;
      updates.unreadPinned = false;
      updates.slaWarnedAt = null;
      updates.slaDangerNotifiedAt = null;
    } else if (countAsUnread) {
      updates.unreadCount = (conv.unreadCount || 0) + 1;
      updates.unreadPinned = false;
      updates.slaWarnedAt = null;
      updates.slaDangerNotifiedAt = null;
    }
    if (isAvito) {
      updates.metadata = mergeAvitoMetadata(conv.metadata, metadataPatch);
      if (msg.channelId && !conv.channelId) updates.channelId = msg.channelId;
    }
    await db.update(schema.conversations).set(updates).where(eq(schema.conversations.id, conv.id));
    conv = {
      ...conv,
      unreadCount: isOperator || isSystem ? 0 : countAsUnread ? (conv.unreadCount || 0) + 1 : (conv.unreadCount || 0),
    };
  }

  if (!isOperator) {
    const enrichName = isAvito
      ? resolveAvitoClientName({
        buyerName: msg.buyerName,
        senderName: msg.senderName,
        accountName: msg.avitoAccountName,
      })
      : msg.senderName;
    await enrichClientOnMessage(client.id, {
      senderName: shouldReplaceClientName(client.name, enrichName, msg.avitoAccountName) ? enrichName : undefined,
      messageText: msg.text,
      phone: msg.phone,
      avitoItemTitle: msg.avitoItemTitle,
    });
  }

  if (!isOperator && !isSystem && countAsUnread) {
    await maybeCreateAutoDealFromMessage({
      clientId: client.id,
      conversationId: conv.id,
      channelType: msg.channelType || conv.channelType || "manual",
      externalChatId: msg.externalChatId,
      avitoItemId: msg.avitoItemId,
      avitoItemTitle: msg.avitoItemTitle,
      avitoPrice: msg.avitoPrice,
    });
  }

  if (isSystem && isAvitoOrderSystemText(msg.text)) {
    let parsedMeta: Record<string, unknown> = {};
    try { parsedMeta = JSON.parse(conv.metadata || "{}"); } catch { /* */ }
    const title = msg.avitoItemTitle || String(parsedMeta.avitoItemTitle || "") || "Заказ с Авито";
    const itemId = msg.avitoItemId || String(parsedMeta.avitoItemId || "");
    const orderIdMatch = msg.text.match(/заказ\s*№?\s*([A-Za-z0-9\-]+)/i);
    const avitoOrderId = orderIdMatch?.[1];
    const existingDeals = await db.select().from(schema.deals).where(eq(schema.deals.clientId, client.id));
    const has = existingDeals.some((d) => {
      if (avitoOrderId && d.avitoOrderId === avitoOrderId) return true;
      if (itemId && d.avitoItemId === itemId && d.status !== "done" && d.status !== "cancelled") return true;
      return false;
    });
    if (!has) {
      await db.insert(schema.deals).values({
        clientId: client.id,
        title,
        orderType: "parts",
        status: "new",
        avitoItemId: itemId || null,
        avitoItemTitle: title,
        avitoPrice: msg.avitoPrice ?? (parsedMeta.avitoPrice as number | undefined),
        avitoOrderId: avitoOrderId || null,
        amount: msg.avitoPrice ?? (parsedMeta.avitoPrice as number | undefined),
        description: `Заказ с Авито${avitoOrderId ? ` №${avitoOrderId}` : ""} · чат ${msg.externalChatId}`,
      });
    }
  }

  let mediaUrl = msg.mediaUrl;
  let mediaType = msg.mediaType;
  const tgFileId = parseTelegramFileId(mediaUrl);
  if (tgFileId && msg.channelId) {
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, msg.channelId));
    const token = channel ? parseConfig(channel.config).botToken : undefined;
    if (token) {
      const file = await downloadTelegramFile(token, tgFileId, mediaType as MediaKind | undefined);
      if (file) {
        try {
          const saved = saveUpload(file.buffer, file.filename, file.mime);
          mediaUrl = saved.url;
          mediaType = saved.mediaType;
        } catch { /* оставляем telegram: ссылку */ }
      }
    }
  }

  const waMediaId = parseWhatsAppMediaId(mediaUrl);
  if (waMediaId && msg.channelId) {
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, msg.channelId));
    const config = channel ? parseConfig(channel.config) : {};
    const file = await downloadWhatsAppMedia(config, waMediaId, mediaType as MediaKind | undefined, msg.text);
    if (file) {
      try {
        const saved = saveUpload(file.buffer, file.filename, file.mime);
        mediaUrl = saved.url;
        mediaType = saved.mediaType;
      } catch { /* оставляем whatsapp: ссылку */ }
    }
  }

  if (mediaUrl?.startsWith("http://") || mediaUrl?.startsWith("https://")) {
    const cached = await cacheHttpMedia(mediaUrl, mediaType as MediaKind | undefined);
    if (cached) {
      mediaUrl = cached.url;
      mediaType = cached.mediaType;
    }
  }

  let messageText = msg.text;
  if (isSystem) {
    messageText = formatAvitoMessageText(messageText);
  } else if (isAvito) {
    messageText = stripAvitoDecorations(messageText);
  }
  if (!mediaUrl && msg.channelType?.includes("avito") && (msg.mediaType || /^\[(фото|видео|файл|медиа|голосовое)\]$/i.test(msg.text))) {
    if (msg.text === "[файл]" || msg.mediaType === "document") {
      messageText = "📎 Клиент приложил файл — API Авито не передаёт содержимое. Откройте диалог в приложении Авито или попросите отправить фото/PDF в WhatsApp.";
    } else if (msg.text === "[голосовое]") {
      messageText = "🎤 Голосовое сообщение (откройте чат в приложении Авито)";
    }
  }

  const existing = await findExistingMessage(conv.id, msg.externalMessageId, {
    text: messageText,
    senderType,
  });
  if (existing) {
    return { client, conversation: conv, message: existing };
  }

  const [savedMsg] = await db.insert(schema.messages).values({
    conversationId: conv.id,
    senderType,
    text: messageText,
    externalMessageId: msg.externalMessageId,
    mediaUrl,
    mediaType,
    createdAt: msg.createdAt,
  }).returning();

  scheduleMessageOcr(savedMsg.id, mediaType);
  await updateConversationPreview(conv.id, savedMsg);

  await db.insert(schema.activityLog).values({
    entityType: "conversation",
    entityId: conv.id,
    action: isOperator ? "message_synced_out" : "message_received",
    details: JSON.stringify({ channel: msg.channelSlug, preview: msg.text.slice(0, 80) }),
  });

  if (isOperator) {
    broadcast({ type: "message_sent", conversationId: conv.id, message: savedMsg });
    return { client, conversation: conv, message: savedMsg };
  }

  if (isSystem) {
    if (isAvito && conv.externalChatId) {
      void markAvitoConversationRead(msg.channelId ?? conv.channelId, msg.channelSlug, conv.externalChatId);
    }
    if (isAvito && isAvitoOfferInterestSystemText(msg.text)) {
      void maybeAutoReplyAvitoOfferInterest(conv.id, msgTime).catch((e) => {
        console.warn(`[avito/auto-reply] conv ${conv.id}:`, e?.message || e);
      });
    }
    broadcast({
      type: "new_message",
      conversationId: conv.id,
      message: savedMsg,
      clientId: client.id,
      senderName: msg.senderName,
      preview: stripAvitoDecorations(msg.text).slice(0, 120),
      isUnread: false,
    });
    return { client, conversation: conv, message: savedMsg };
  }

  await markOperatorMessagesReadBefore(conv.id, msgTime);

  const msgAgeMs = Date.now() - msgTime.getTime();
  const isFreshMessage = msgAgeMs < 3 * 60 * 1000;
  if (countAsUnread && isFreshMessage) {
    const operators = await db.select().from(schema.users).where(eq(schema.users.isActive, true));
    const targets = conv.assignedTo
      ? operators.filter((op) => op.id === conv.assignedTo)
      : operators;
    for (const op of targets) {
      await notifyUser({
        userId: op.id,
        type: "new_message",
        title: `Новое сообщение: ${msg.senderName}`,
        text: msg.text.slice(0, 120),
        link: `/?conv=${conv.id}`,
      });
    }
  }

  broadcast({
    type: "new_message",
    conversationId: conv.id,
    message: savedMsg,
    clientId: client.id,
    senderName: msg.senderName,
    preview: msg.text.slice(0, 120),
    isUnread: countAsUnread,
    clientEnriched: true,
  });

  return { client, conversation: conv, message: savedMsg };
}

export type SendOutgoingOpts = {
  mediaUrl?: string;
  mediaType?: MediaKind;
};

export async function sendOutgoing(
  conversationId: number,
  text: string,
  senderId?: number,
  opts?: SendOutgoingOpts,
) {
  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
  if (!conv) throw new Error("Диалог не найден");

  const hasMedia = Boolean(opts?.mediaUrl);
  let mediaType = opts?.mediaType || (opts?.mediaUrl ? mediaTypeFromUrl(opts.mediaUrl) : undefined);
  if (opts?.mediaUrl) {
    const file = resolveUploadPath(opts.mediaUrl);
    if (file) mediaType = file.mediaType;
  }
  const trimmed = (text || "").trim();
  if (!trimmed && !hasMedia) throw new Error("Пустое сообщение");
  const mediaLabel = hasMedia && mediaType ? mediaPlaceholder(mediaType) : "";

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, conv.clientId));
  const deliveryStatus = initialDeliveryStatus(conv.channelType);

  if (!conv.channelId || conv.channelType === "manual") {
    const [msg] = await db.insert(schema.messages).values({
      conversationId,
      senderType: "operator",
      senderId,
      text: trimmed || mediaLabel,
      mediaUrl: opts?.mediaUrl,
      mediaType: mediaType,
      deliveryStatus,
    }).returning();
    await db.update(schema.conversations).set({
      ...previewPatchFromMessage(msg),
      unreadCount: 0,
      unreadPinned: false,
    }).where(eq(schema.conversations.id, conversationId));
    return { message: msg, delivered: false };
  }

  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, conv.channelId));
  if (!channel) throw new Error("Канал не найден");

  let config = parseConfig(channel.config);
  const result = await sendChannelMessage(
    channel.type,
    config,
    conv.externalChatId!,
    trimmed,
    client?.phone,
    hasMedia ? { mediaUrl: opts!.mediaUrl!, mediaType: mediaType! } : undefined,
  );

  if (result.config) {
    await db.update(schema.channels).set({ config: stringifyConfig(result.config) }).where(eq(schema.channels.id, channel.id));
  }

  if (!result.ok) {
    throw new Error(result.error || "Не удалось отправить сообщение");
  }

  let finalDeliveryStatus: typeof deliveryStatus = deliveryStatus;
  if (channel.type === "avito" && result.externalMessageId && conv.externalChatId) {
    const verified = await verifyAvitoMessageDelivered(config, conv.externalChatId, result.externalMessageId);
    finalDeliveryStatus = verified ? "delivered" : "failed";
    if (!verified) {
      console.warn(
        "[send/avito] не подтверждено в API",
        conv.externalChatId,
        result.externalMessageId,
      );
    }
  } else if (channel.type === "telegram") {
    finalDeliveryStatus = "delivered";
  }

  const existing = await findExistingMessage(conversationId, result.externalMessageId, {
    text: trimmed || mediaLabel,
    senderType: "operator",
  });
  if (existing) {
    await db.update(schema.conversations).set({
      ...previewPatchFromMessage(existing),
      unreadCount: 0,
      unreadPinned: false,
    }).where(eq(schema.conversations.id, conversationId));
    await clearConversationSlaAlerts(conversationId);
    return { message: existing, delivered: true };
  }

  const [msg] = await db.insert(schema.messages).values({
    conversationId,
    senderType: "operator",
    senderId,
    text: trimmed || mediaLabel,
    mediaUrl: opts?.mediaUrl,
    mediaType: mediaType,
    externalMessageId: result.externalMessageId,
    deliveryStatus: finalDeliveryStatus,
  }).returning();

  await db.update(schema.conversations).set({
    ...previewPatchFromMessage(msg),
    unreadCount: 0,
    unreadPinned: false,
  }).where(eq(schema.conversations.id, conversationId));

  await clearConversationSlaAlerts(conversationId);
  broadcast({ type: "message_sent", conversationId, message: msg });
  if (senderId) {
    void trackActivityEvent(senderId, "message_sent", "conversation", conversationId);
  }

  return { message: msg, delivered: true };
}

const AVITO_DELETE_MAX_AGE_MS = 60 * 60 * 1000;

export async function deleteConversationMessage(
  conversationId: number,
  messageId: number,
  userId?: number,
) {
  const [msg] = await db.select().from(schema.messages).where(eq(schema.messages.id, messageId));
  if (!msg || msg.conversationId !== conversationId) {
    throw new Error("Сообщение не найдено");
  }

  const [conv] = await db.select().from(schema.conversations).where(eq(schema.conversations.id, conversationId));
  if (!conv) throw new Error("Диалог не найден");

  let avitoDeleted = false;
  let crmOnly = false;

  if (msg.senderType === "operator" && conv.channelId && conv.externalChatId && msg.externalMessageId) {
    const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, conv.channelId));
    if (channel?.type === "avito") {
      const msgAge = Date.now() - new Date(msg.createdAt ?? 0).getTime();
      if (msgAge > AVITO_DELETE_MAX_AGE_MS) {
        throw new Error("Авито: удалить можно только в течение часа после отправки");
      }
      let config = parseConfig(channel.config);
      const result = await deleteAvitoMessage(config, conv.externalChatId, msg.externalMessageId);
      if (result.config) {
        await db.update(schema.channels)
          .set({ config: stringifyConfig(result.config) })
          .where(eq(schema.channels.id, channel.id));
      }
      if (!result.ok) {
        throw new Error(result.error || "Не удалось удалить сообщение в Авито");
      }
      avitoDeleted = true;
    }
  } else if (msg.senderType !== "operator") {
    crmOnly = true;
  }

  await db.delete(schema.messages).where(eq(schema.messages.id, messageId));
  await repairConversationPreviews(conversationId);

  await db.insert(schema.activityLog).values({
    entityType: "conversation",
    entityId: conversationId,
    action: "message_deleted",
    userId: userId ?? null,
    details: JSON.stringify({
      messageId,
      senderType: msg.senderType,
      avitoDeleted,
      crmOnly,
      preview: (msg.text || "").slice(0, 80),
    }),
  });

  broadcast({
    type: "message_deleted",
    conversationId,
    messageId,
  });

  return { ok: true, avitoDeleted, crmOnly };
}
