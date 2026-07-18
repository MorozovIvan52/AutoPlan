import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and, gte } from "drizzle-orm";
import { llmCompletion, isLlmConfigured } from "./llm";
import { parseConvMetadata } from "./conv-meta";
import {
  isAvitoSystemMessageText,
  isAvitoOfferInterestSystemText,
  isAvitoOrderSystemText,
  stripAvitoDecorations,
} from "./avito-context";
import { getWaitMinutes, needsManagerResponse } from "./chat-sla";
import { isTodayMoscow, startOfTodayMoscow } from "./moscow-time";
import { forTenant, tenantId } from "./tenant-query";

const SYSTEM_PROMPT = `Ты — ассистент оператора CRM автозапчастей и СТО в России.
Пиши короткие вежливые сообщения клиентам на русском. Без markdown и подписи.`;

const STRONG_BUY_KEYWORDS = /куплю|заказать|оформ(ить|лю|им)|беру|возьму|выстав(ьте|ите)\s+сч[её]т|сч[её]т\s+на|есть\s+в\s+наличии|наличии\s+есть|пришл(ите|и)\s+(фото|цену|сч[её]т)|сколько\s+стоит|какая\s+цена|прайс|подбер(ите|и)|нужн[аоы]\s+(запчаст|детал|редуктор|привод)/i;
const WEAK_BUY_KEYWORDS = /цена|стоим|наличи|vin|запчаст|детал|аналог|оригинал|доставк|сдэк|самовывоз/i;
const REPAIR_KEYWORDS = /ремонт|запис|диагност|сто|сервис|пригон|неисправ|стук|теч/i;
const LOW_INTENT_GREETING = /^(здравствуйте|добрый\s+(день|вечер|утро)|привет|доброе\s+утро)[\s!.?]*$/i;

function isRealClientMessage(msg: { senderType?: string | null; text?: string | null } | undefined) {
  if (!msg || msg.senderType !== "client") return false;
  const text = stripAvitoDecorations(msg.text || "");
  if (!text) return false;
  return !isAvitoSystemMessageText(msg.text);
}

function clientTextsFromMessages(msgs: { senderType?: string | null; text?: string | null }[]) {
  return msgs
    .filter(isRealClientMessage)
    .map((m) => stripAvitoDecorations(m.text || ""))
    .filter(Boolean);
}

function hasStrongBuyIntent(texts: string[]) {
  return texts.some((t) => STRONG_BUY_KEYWORDS.test(t));
}

function hasWeakBuyIntent(texts: string[]) {
  return texts.some((t) => WEAK_BUY_KEYWORDS.test(t));
}

function hasRepairIntent(texts: string[]) {
  return texts.some((t) => REPAIR_KEYWORDS.test(t));
}

function isLowIntentOnly(texts: string[]) {
  if (!texts.length) return true;
  return texts.every((t) => LOW_INTENT_GREETING.test(t.trim()) || t.trim().length < 8);
}

type OpportunityType = "hot_lead" | "no_reply" | "avito_deal" | "repair_intent" | "quote_request" | "follow_up";

export type ChatOpportunity = {
  conversationId: number;
  clientId: number;
  clientName: string;
  channelType: string | null;
  lastMessageAt: string | null;
  lastClientText: string;
  unreadCount: number;
  opportunityType: OpportunityType;
  opportunityLabel: string;
  score: number;
  reason: string;
  proposedText: string;
  hasActiveDeal: boolean;
  avitoItemTitle?: string | null;
  avitoPrice?: number | null;
};

type ScoreResult = {
  score: number;
  opportunityType: OpportunityType;
  opportunityLabel: string;
  reason: string;
};

function avitoSystemSignals(msgs: { text?: string | null }[]) {
  let offerPing = false;
  let order = false;
  for (const m of msgs) {
    const t = m.text || "";
    if (isAvitoOfferInterestSystemText(t)) offerPing = true;
    if (isAvitoOrderSystemText(t)) order = true;
  }
  return { offerPing, order };
}

function scoreConversation(opts: {
  waitingReply: boolean;
  waitMinutes: number;
  clientTexts: string[];
  lastClientText: string;
  meta?: ReturnType<typeof parseConvMetadata>;
  hasActiveDeal: boolean;
  unreadCount: number;
  avitoOfferPing: boolean;
  avitoOrder: boolean;
  reviewToday: boolean;
  operatorRepliedLast: boolean;
}): ScoreResult | null {
  const {
    waitingReply,
    waitMinutes,
    clientTexts,
    lastClientText,
    meta,
    hasActiveDeal,
    unreadCount,
    avitoOfferPing,
    avitoOrder,
    reviewToday,
    operatorRepliedLast,
  } = opts;

  const strongBuy = hasStrongBuyIntent(clientTexts);
  const weakBuy = hasWeakBuyIntent(clientTexts);
  const repair = hasRepairIntent(clientTexts);
  const lowIntent = isLowIntentOnly(clientTexts);

  if (!waitingReply && !strongBuy && !repair && !avitoOrder && !avitoOfferPing) {
    if (!reviewToday) return null;
    const preview = lastClientText || clientTexts[0] || "";
    const score = hasActiveDeal ? 16 : operatorRepliedLast ? 18 : 22;
    return {
      score,
      opportunityType: "follow_up",
      opportunityLabel: operatorRepliedLast ? "Доработка после ответа" : "Чат за сегодня",
      reason: preview
        ? `Сегодня в чате: «${preview.slice(0, 72)}${preview.length > 72 ? "…" : ""}» — проверьте, нужен ли дожим`
        : "Активность в чате сегодня — уточните, остались ли вопросы у клиента",
    };
  }

  let score = 0;
  let opportunityType: OpportunityType = "no_reply";
  let opportunityLabel = "Нужен ответ";
  let reason = "Открытый диалог";

  if (avitoOrder && !hasActiveDeal) {
    score = 88;
    opportunityType = "avito_deal";
    opportunityLabel = "Заказ на Авито";
    reason = "Системное уведомление Авито об оплате/заказе — оформите в CRM";
    return { score, opportunityType, opportunityLabel, reason };
  }

  if (waitingReply) {
    score += 18 + Math.min(12, Math.floor(waitMinutes / 10));
    if (unreadCount > 1) score += Math.min(8, unreadCount * 2);
    opportunityType = "no_reply";
    opportunityLabel = "Ждёт ответа";
    reason = lastClientText
      ? `Клиент: «${lastClientText.slice(0, 72)}${lastClientText.length > 72 ? "…" : ""}»`
      : "Есть непрочитанные сообщения клиента";
  }

  if (repair) {
    score += 28;
    opportunityType = "repair_intent";
    opportunityLabel = "Запись на ремонт";
    reason = "Клиент спрашивает про ремонт или диагностику";
  } else if (strongBuy) {
    score += 32;
    opportunityType = "quote_request";
    opportunityLabel = "Запрос на покупку";
    reason = "Явный интерес к покупке или подбору запчасти";
  } else if (weakBuy && !lowIntent) {
    score += 14;
    opportunityType = "quote_request";
    opportunityLabel = "Вопрос по запчастям";
    reason = "Уточнение по цене, наличию или доставке";
  }

  if (avitoOfferPing && (waitingReply || unreadCount > 0)) {
    score = Math.max(score, 42);
    if (!strongBuy && !repair) {
      opportunityType = "no_reply";
      opportunityLabel = "Авито: интерес к предложению";
      reason = "Авито сообщает об интересе — уточните VIN и актуальность";
    }
  }

  if (meta?.avitoItemTitle && !hasActiveDeal) {
    if (strongBuy || repair) {
      score += 12;
      opportunityType = "avito_deal";
      opportunityLabel = "Сделка с Авито";
      reason = `Интерес к «${meta.avitoItemTitle}»${meta.avitoPrice ? ` · ${meta.avitoPrice} ₽` : ""}`;
    } else if (waitingReply && !lowIntent) {
      score += 6;
      if (opportunityType === "no_reply") {
        opportunityLabel = "Сделка с Авито";
        reason = `Диалог по «${meta.avitoItemTitle}» — уточните запрос клиента`;
      }
    }
  }

  if (hasActiveDeal) {
    score = Math.max(0, score - 30);
    if (score < 25 && !reviewToday) return null;
    if (score < 12 && reviewToday) score = 12;
    reason = `${reason} · заказ уже в CRM`;
  }

  if (lowIntent && !strongBuy && !repair) {
    score = Math.min(score, reviewToday ? 42 : 38);
  }

  const hotLead = waitingReply && score >= 62 && (strongBuy || repair || (meta?.avitoItemTitle && !lowIntent && !hasActiveDeal));
  if (hotLead) {
    score = Math.min(100, score + 8);
    opportunityType = "hot_lead";
    opportunityLabel = "🔥 Горячий лид";
    reason = "Высокая вероятность сделки — ответьте в первую очередь";
  }

  score = Math.min(100, Math.round(score));
  const minScore = reviewToday ? 12 : 28;
  if (score < minScore) return null;

  return { score, opportunityType, opportunityLabel, reason };
}

export type ProposalDraft = {
  stage: "inbox" | "deal" | "repair" | "delivery" | "parts";
  actionType: "reply" | "appointment" | "quote" | "follow_up" | "notify";
  title: string;
  reason: string;
  proposedText: string;
  conversationId?: number;
  clientId?: number;
  dealId?: number;
  appointmentId?: number;
  priority: number;
  dedupeKey: string;
};

async function polishText(draft: string, context: string): Promise<string> {
  if (!isLlmConfigured()) return draft;
  try {
    return await llmCompletion([
      { role: "system", text: SYSTEM_PROMPT },
      { role: "user", text: `${context}\n\nУлучши черновик (сохрани смысл):\n${draft}\n\nТолько текст сообщения клиенту.` },
    ]);
  } catch {
    return draft;
  }
}

async function lastClientMessage(conversationId: number) {
  const msgs = await db.select().from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(desc(schema.messages.createdAt))
    .limit(5);
  return msgs.find((m) => m.senderType === "client") || msgs[0];
}

async function findConversationForClient(clientId: number) {
  const convs = await db.select().from(schema.conversations)
    .where(and(forTenant(schema.conversations), eq(schema.conversations.clientId, clientId)))
    .orderBy(desc(schema.conversations.lastMessageAt));
  return convs[0];
}

function buildReplyDraft(
  clientName: string,
  lastText: string,
  meta?: ReturnType<typeof parseConvMetadata>,
  opts?: { followUp?: boolean },
): string {
  const item = meta?.avitoItemTitle ? ` по объявлению «${meta.avitoItemTitle}»` : "";
  if (opts?.followUp) {
    return `Здравствуйте, ${clientName}!${item} Подскажите, наше предложение ещё актуально? Если удобнее обсудить по телефону — +7 968 449-69-99.`;
  }
  if (isAvitoOfferInterestSystemText(lastText)) {
    return `Здравствуйте, ${clientName}!${item} Подскажите, предложение ещё актуально? Пришлите VIN (17 символов) — проверим применяемость и наличие. Тел. +7 968 449-69-99.`;
  }
  if (REPAIR_KEYWORDS.test(lastText)) {
    return `Здравствуйте, ${clientName}! По вашему вопросу о ремонте${item} — можем записать на диагностику. Укажите удобную дату и время, или пришлите VIN для уточнения работ.`;
  }
  if (STRONG_BUY_KEYWORDS.test(lastText) || WEAK_BUY_KEYWORDS.test(lastText)) {
    return `Здравствуйте, ${clientName}!${item} Уточню наличие и цену. Пришлите VIN (17 символов) или марку/модель/год — подберём точнее.`;
  }
  return `Здравствуйте, ${clientName}!${item} Спасибо за сообщение. Сейчас уточню и отвечу в ближайшее время.`;
}

export type ScanChatOptions = {
  limit?: number;
  /** today — все чаты с активностью сегодня (МСК); week — только «горячие» за 7 дней */
  period?: "today" | "week";
};

export async function scanChatOpportunities(
  limitOrOptions: number | ScanChatOptions = {},
): Promise<ChatOpportunity[]> {
  const options: ScanChatOptions = typeof limitOrOptions === "number"
    ? { limit: limitOrOptions, period: "week" }
    : limitOrOptions;
  const limit = options.limit ?? 150;
  const period = options.period ?? "today";
  const reviewToday = period === "today";

  const opportunities: ChatOpportunity[] = [];
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const todayStart = startOfTodayMoscow();

  const convs = await db
    .select({ conv: schema.conversations, client: schema.clients })
    .from(schema.conversations)
    .innerJoin(schema.clients, eq(schema.conversations.clientId, schema.clients.id))
    .where(
      reviewToday
        ? and(
          forTenant(schema.conversations),
          eq(schema.conversations.status, "open"),
          gte(schema.conversations.lastMessageAt, todayStart),
        )
        : and(forTenant(schema.conversations), eq(schema.conversations.status, "open")),
    )
    .orderBy(desc(schema.conversations.lastMessageAt));

  for (const { conv, client } of convs) {
    if (!reviewToday && conv.lastMessageAt && conv.lastMessageAt < weekAgo) continue;
    if (reviewToday && !isTodayMoscow(conv.lastMessageAt)) continue;

    const msgs = await db.select().from(schema.messages)
      .where(eq(schema.messages.conversationId, conv.id))
      .orderBy(desc(schema.messages.createdAt))
      .limit(reviewToday ? 40 : 8);

    const todayMsgs = reviewToday ? msgs.filter((m) => isTodayMoscow(m.createdAt)) : msgs;
    const analysisMsgs = todayMsgs.length > 0 ? todayMsgs : msgs;

    const lastRealClient = analysisMsgs.find(isRealClientMessage);
    const lastAny = msgs[0];
    if (!lastAny) continue;

    const clientTexts = clientTextsFromMessages(analysisMsgs);
    const lastClientText = lastRealClient
      ? stripAvitoDecorations(lastRealClient.text || "")
      : clientTexts[0] || "";
    const meta = parseConvMetadata(conv.metadata);

    const clientDeals = await db.select().from(schema.deals)
      .where(and(forTenant(schema.deals), eq(schema.deals.clientId, client.id)));
    const hasActiveDeal = clientDeals.some((d) => d.status !== "done" && d.status !== "cancelled");

    const avitoSignals = avitoSystemSignals(analysisMsgs);
    const waitingReply = needsManagerResponse(conv.unreadCount, lastAny);
    const waitMinutes = waitingReply && lastRealClient?.createdAt
      ? getWaitMinutes(lastRealClient.createdAt)
      : 0;
    const operatorRepliedLast = lastAny.senderType === "operator";

    const scored = scoreConversation({
      waitingReply,
      waitMinutes,
      clientTexts,
      lastClientText,
      meta,
      hasActiveDeal,
      unreadCount: conv.unreadCount || 0,
      avitoOfferPing: avitoSignals.offerPing,
      avitoOrder: avitoSignals.order,
      reviewToday,
      operatorRepliedLast,
    });
    if (!scored) continue;

    const { score, opportunityType, opportunityLabel, reason } = scored;
    const followUp = opportunityType === "follow_up" || (operatorRepliedLast && !waitingReply);

    opportunities.push({
      conversationId: conv.id,
      clientId: client.id,
      clientName: client.name,
      channelType: conv.channelType,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      lastClientText: lastClientText.slice(0, 200),
      unreadCount: conv.unreadCount || 0,
      opportunityType,
      opportunityLabel,
      score,
      reason,
      proposedText: buildReplyDraft(client.name, lastClientText, meta, { followUp }),
      hasActiveDeal,
      avitoItemTitle: meta?.avitoItemTitle ?? null,
      avitoPrice: meta?.avitoPrice ?? null,
    });
  }

  return opportunities
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function scanInboxStage(): Promise<ProposalDraft[]> {
  const chatOps = (await scanChatOpportunities({ period: "today", limit: 100 }))
    .filter((o) => o.score >= 35 && o.opportunityType !== "follow_up");
  return chatOps.map((o) => ({
    stage: "inbox" as const,
    actionType: "reply" as const,
    title: `${o.opportunityLabel}: ${o.clientName}`,
    reason: o.reason,
    proposedText: o.proposedText,
    conversationId: o.conversationId,
    clientId: o.clientId,
    priority: o.score,
    dedupeKey: `inbox:${o.conversationId}`,
  }));
}

export async function scanDealStage(): Promise<ProposalDraft[]> {
  const proposals: ProposalDraft[] = [];
  const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

  const deals = await db
    .select({ deal: schema.deals, client: schema.clients })
    .from(schema.deals)
    .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id))
    .where(and(forTenant(schema.deals), eq(schema.deals.status, "quoted")));

  for (const { deal, client } of deals) {
    if (deal.updatedAt && deal.updatedAt > twoDaysAgo) continue;
    const conv = await findConversationForClient(client.id);
    if (!conv) continue;

    let proposedText = `Здравствуйте! Напоминаем по заказу «${deal.title}»${deal.amount ? ` на сумму ${deal.amount.toLocaleString("ru-RU")} ₽` : ""}. Готовы оформить или нужны уточнения?`;
    proposedText = await polishText(proposedText, `Сделка в статусе КП отправлено, клиент не ответил 2+ дня`);

    proposals.push({
      stage: "deal",
      actionType: "follow_up",
      title: `Дожать КП: ${deal.title}`,
      reason: "КП отправлено, клиент молчит 2+ дня",
      proposedText,
      conversationId: conv.id,
      clientId: client.id,
      dealId: deal.id,
      priority: 60,
      dedupeKey: `deal:${deal.id}:followup`,
    });
  }

  const inProgress = await db.select({ deal: schema.deals, client: schema.clients })
    .from(schema.deals)
    .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id))
    .where(and(forTenant(schema.deals), eq(schema.deals.status, "in_progress")));

  for (const { deal, client } of inProgress) {
    if (deal.updatedAt && deal.updatedAt > twoDaysAgo) continue;
    const conv = await findConversationForClient(client.id);
    if (!conv) continue;

    const proposedText = await polishText(
      `Здравствуйте! По заказу «${deal.title}» работы в процессе. Сообщим, как только будет готово. Есть вопросы — пишите.`,
      "Сделка в работе, давно не было контакта",
    );

    proposals.push({
      stage: "deal",
      actionType: "notify",
      title: `Статус заказа: ${deal.title}`,
      reason: "Заказ в работе — предложить обновление клиенту",
      proposedText,
      conversationId: conv.id,
      clientId: client.id,
      dealId: deal.id,
      priority: 50,
      dedupeKey: `deal:${deal.id}:status`,
    });
  }

  return proposals;
}

export async function scanRepairStage(): Promise<ProposalDraft[]> {
  const proposals: ProposalDraft[] = [];
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  const dayAfter = new Date(tomorrow);
  dayAfter.setDate(dayAfter.getDate() + 1);

  const rows = await db.select({ appt: schema.serviceAppointments, client: schema.clients })
    .from(schema.serviceAppointments)
    .leftJoin(schema.clients, eq(schema.serviceAppointments.clientId, schema.clients.id))
    .where(and(forTenant(schema.serviceAppointments), eq(schema.serviceAppointments.status, "scheduled")));

  for (const { appt, client } of rows) {
    const at = appt.scheduledAt;
    if (!at || at < tomorrow || at >= dayAfter) continue;

    const conv = appt.clientId ? await findConversationForClient(appt.clientId) : null;
    const time = at.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    const date = at.toLocaleDateString("ru-RU", { day: "numeric", month: "long" });
    const car = [appt.plate, appt.make, appt.model].filter(Boolean).join(" ");

    let proposedText = `Напоминаем: завтра (${date}) в ${time} ждём вас на СТО${car ? `, ${car}` : ""}. Работы: ${appt.title}. Подтвердите, пожалуйста.`;
    proposedText = await polishText(proposedText, "Подтверждение записи на ремонт");

    proposals.push({
      stage: "repair",
      actionType: "appointment",
      title: `Подтвердить запись: ${appt.title}`,
      reason: `Запись завтра в ${time}, статус «записан»`,
      proposedText,
      conversationId: conv?.id,
      clientId: appt.clientId ?? undefined,
      appointmentId: appt.id,
      priority: 80,
      dedupeKey: `repair:${appt.id}:confirm`,
    });
  }

  return proposals;
}

export async function scanDeliveryStage(): Promise<ProposalDraft[]> {
  const proposals: ProposalDraft[] = [];

  const deals = await db
    .select({ deal: schema.deals, client: schema.clients })
    .from(schema.deals)
    .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id));

  for (const { deal, client } of deals) {
    if (!deal.cdekTrackNumber || deal.status === "done" || deal.status === "cancelled") continue;
    const conv = await findConversationForClient(client.id);
    if (!conv) continue;

    const proposedText = await polishText(
      `Здравствуйте! Ваш заказ «${deal.title}» отправлен СДЭК, трек: ${deal.cdekTrackNumber}${deal.cdekPvzAddress ? `. ПВЗ: ${deal.cdekPvzAddress}` : ""}. Сообщите, когда заберёте.`,
      "Уведомление о доставке СДЭК",
    );

    proposals.push({
      stage: "delivery",
      actionType: "notify",
      title: `СДЭК: ${deal.title}`,
      reason: `Трек ${deal.cdekTrackNumber}, статус: ${deal.cdekStatus || "в пути"}`,
      proposedText,
      conversationId: conv.id,
      clientId: client.id,
      dealId: deal.id,
      priority: 55,
      dedupeKey: `delivery:${deal.id}:${deal.cdekTrackNumber}`,
    });
  }

  return proposals;
}

export async function scanPartsStage(): Promise<ProposalDraft[]> {
  const proposals: ProposalDraft[] = [];

  const parts = await db.select().from(schema.partsStock).where(forTenant(schema.partsStock));
  const critical = parts.filter((p) => (p.qty ?? 0) <= (p.minQty ?? 2));

  for (const part of critical.slice(0, 5)) {
    const deals = await db.select({ deal: schema.deals, client: schema.clients })
      .from(schema.deals)
      .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id))
      .where(and(forTenant(schema.deals), eq(schema.deals.status, "in_progress")))
      .limit(20);

    for (const { deal, client } of deals) {
      if (!deal.description?.toLowerCase().includes(part.article?.toLowerCase() || "___")) continue;
      const conv = await findConversationForClient(client.id);
      if (!conv) continue;

      const proposedText = await polishText(
        `Здравствуйте! По заказу «${deal.title}»: позиция ${part.article} (${part.name}) сейчас на уточнении срока поставки. Предложим аналог или перенесём срок — как удобнее?`,
        "Запчасть на исходе по активному заказу",
      );

      proposals.push({
        stage: "parts",
        actionType: "quote",
        title: `Запчасть: ${part.article}`,
        reason: `Остаток ${part.qty ?? 0} шт., заказ ${deal.title}`,
        proposedText,
        conversationId: conv.id,
        clientId: client.id,
        dealId: deal.id,
        priority: 65,
        dedupeKey: `parts:${deal.id}:${part.id}`,
      });
    }
  }

  return proposals;
}

export async function runAllScanners(): Promise<ProposalDraft[]> {
  const results = await Promise.all([
    scanInboxStage(),
    scanDealStage(),
    scanRepairStage(),
    scanDeliveryStage(),
    scanPartsStage(),
  ]);
  return results.flat().sort((a, b) => b.priority - a.priority);
}

export async function persistProposals(drafts: ProposalDraft[]): Promise<number> {
  let created = 0;
  for (const d of drafts) {
    if (d.dedupeKey) {
      const [existing] = await db.select().from(schema.aiProposals)
        .where(and(
          forTenant(schema.aiProposals),
          eq(schema.aiProposals.dedupeKey, d.dedupeKey),
          eq(schema.aiProposals.status, "pending"),
        ))
        .limit(1);
      if (existing) continue;
    }

    await db.insert(schema.aiProposals).values({
      tenantId: tenantId(),
      stage: d.stage,
      actionType: d.actionType,
      title: d.title,
      reason: d.reason,
      proposedText: d.proposedText,
      editedText: d.proposedText,
      conversationId: d.conversationId ?? null,
      clientId: d.clientId ?? null,
      dealId: d.dealId ?? null,
      appointmentId: d.appointmentId ?? null,
      priority: d.priority,
      dedupeKey: d.dedupeKey,
      status: "pending",
    });
    created++;
  }
  return created;
}
