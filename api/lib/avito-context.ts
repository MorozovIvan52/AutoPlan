export type AvitoItemContext = {
  avitoItemId?: string;
  avitoItemTitle?: string;
  avitoPrice?: number;
  avitoItemUrl?: string;
  avitoItemImageUrl?: string;
};

function pickImageUrl(value: any): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && value.startsWith("http")) return value;
  const sizes = value.sizes ?? value;
  if (typeof sizes === "object" && sizes) {
    for (const k of ["640x480", "320x240", "140x105", "1280x960"]) {
      const u = sizes[k];
      if (typeof u === "string" && u.startsWith("http")) return u;
    }
    const first = Object.values(sizes).find((v) => typeof v === "string" && (v as string).startsWith("http"));
    if (first) return first as string;
  }
  return undefined;
}

function imageFromItemBlock(block: any): string | undefined {
  if (!block) return undefined;
  return pickImageUrl(block.image)
    ?? pickImageUrl(block.main_photo)
    ?? pickImageUrl(block.preview)
    ?? (Array.isArray(block.images) ? pickImageUrl(block.images[0]) : undefined);
}

function parsePrice(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  if (typeof raw === "number" && !Number.isNaN(raw)) return raw;
  const n = Number(String(raw).replace(/[^\d.,]/g, "").replace(",", "."));
  return Number.isNaN(n) ? undefined : n;
}

function itemUrlFromId(itemId: string | number | undefined): string | undefined {
  if (itemId == null || itemId === "") return undefined;
  return `https://www.avito.ru/items/${itemId}`;
}

/** Извлекает объявление из объекта чата Авито (Messenger API) */
export function extractAvitoItemFromChat(chat: any): AvitoItemContext {
  const ctx = chat?.context ?? chat?.item ?? {};
  const value = ctx?.value ?? ctx;
  const itemId = value?.id ?? value?.item_id ?? ctx?.item_id ?? chat?.item_id;
  const title = value?.title ?? value?.name ?? ctx?.title ?? chat?.title;
  const url = value?.url ?? value?.item_url ?? value?.uri ?? ctx?.url;
  const price = parsePrice(value?.price_value ?? value?.price ?? value?.price_string ?? ctx?.price);

  return {
    avitoItemId: itemId != null ? String(itemId) : undefined,
    avitoItemTitle: title ? String(title) : undefined,
    avitoPrice: price,
    avitoItemUrl: url ? String(url) : itemUrlFromId(itemId),
    avitoItemImageUrl: imageFromItemBlock(value) ?? imageFromItemBlock(ctx),
  };
}

/** Из payload сообщения / webhook */
export function extractAvitoItemFromMessage(value: any): AvitoItemContext {
  const ctx = value?.context ?? value?.item ?? {};
  const inner = ctx?.value ?? ctx;
  const itemId = inner?.item_id ?? inner?.id ?? ctx?.item_id ?? value?.item_id;
  const title = inner?.title ?? ctx?.title ?? value?.item_title ?? value?.title;
  const url = inner?.url ?? inner?.item_url ?? ctx?.url ?? value?.item_url;
  const price = parsePrice(inner?.price_value ?? inner?.price ?? ctx?.price ?? value?.price);

  return {
    avitoItemId: itemId != null ? String(itemId) : undefined,
    avitoItemTitle: title ? String(title) : undefined,
    avitoPrice: price,
    avitoItemUrl: url ? String(url) : itemUrlFromId(itemId),
    avitoItemImageUrl: imageFromItemBlock(inner) ?? imageFromItemBlock(ctx) ?? imageFromItemBlock(value),
  };
}

export function buildAvitoMetadata(
  item: AvitoItemContext,
  account: { name: string; id?: number },
): string {
  const payload: Record<string, unknown> = {
    avitoAccountName: account.name,
    avitoChannelId: account.id,
  };
  if (item.avitoItemId) payload.avitoItemId = item.avitoItemId;
  if (item.avitoItemTitle) payload.avitoItemTitle = item.avitoItemTitle;
  if (item.avitoPrice != null) payload.avitoPrice = item.avitoPrice;
  if (item.avitoItemUrl) payload.avitoItemUrl = item.avitoItemUrl;
  if (item.avitoItemImageUrl) payload.avitoItemImageUrl = item.avitoItemImageUrl;
  return JSON.stringify(payload);
}

function pickAvitoUserName(user: any): string {
  const candidates = [
    user?.name,
    user?.profile_name,
    user?.public_name,
    user?.public_user_profile?.name,
    user?.public_user_profile?.profile_name,
  ];
  for (const raw of candidates) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name && !isAvitoAccountLabel(name)) return name;
  }
  return "";
}

/** Имя аккаунта продавца на Авито, а не покупателя */
export function isAvitoAccountLabel(name: string | null | undefined, accountName?: string | null): boolean {
  if (!name) return false;
  const n = name.trim().toLowerCase().replace(/ё/g, "е");
  if (!n) return false;
  if (accountName) {
    const a = accountName.trim().toLowerCase().replace(/ё/g, "е");
    if (a && n === a) return true;
  }
  if (/^авито[\s—\-–·|]/.test(n)) return true;
  if (/^avito[\s\-_|]/i.test(name.trim())) return true;
  if (/авито\s*\d/.test(n)) return true;
  if (n.includes("авито") && /основн|главн|магазин|аккаунт|продаж/.test(n)) return true;
  return false;
}

/** Участник чата — клиент (не аккаунт продавца) */
export function extractChatClient(
  chat: any,
  accountUserId: string,
): { externalUserId: string; senderName: string } | null {
  const accountId = String(accountUserId);

  const interlocutor = chat?.interlocutor ?? chat?.user;
  if (interlocutor) {
    const id = String(interlocutor.id ?? interlocutor.user_id ?? interlocutor.public_user_profile?.user_id ?? "");
    if (id && id !== accountId && id !== "0") {
      const senderName = pickAvitoUserName(interlocutor);
      if (senderName) return { externalUserId: id, senderName };
    }
  }

  const users = chat?.users ?? chat?.participants ?? [];
  for (const u of users) {
    const id = String(u.id ?? u.user_id ?? u.public_user_profile?.user_id ?? "");
    if (id && id !== accountId && id !== "0") {
      const senderName = pickAvitoUserName(u);
      if (senderName) return { externalUserId: id, senderName };
    }
  }

  const last = chat?.last_message ?? chat?.lastMessage;
  if (last) {
    const authorId = String(last.author_id ?? last.authorId ?? last.author?.id ?? last.user_id ?? "");
    const direction = last.direction ?? last.message?.direction;
    if (authorId && authorId !== accountId && authorId !== "0" && direction === "in") {
      const senderName = pickAvitoUserName(last.author ?? last);
      if (!isAvitoAccountLabel(senderName)) {
        return { externalUserId: authorId, senderName };
      }
    }
  }

  return null;
}

export function isInvalidAvitoExternalId(id: string | null | undefined): boolean {
  if (!id) return true;
  const v = String(id).trim();
  return v === "" || v === "0" || v === "unknown";
}

export function getAvitoMessageRole(
  msg: any,
  accountUserId: string,
): "client" | "operator" | "system" | null {
  if (!msg) return null;

  const text = msg.content?.text ?? msg.text ?? msg.body?.text ?? "";
  const plainText = typeof text === "string" ? stripAvitoDecorations(text) : "";

  if (msg.type === "system" || msg.message_type === "system") return "system";
  const msgType = msg.type ?? msg.content?.type ?? msg.message_type;
  if (msgType === "item" || msgType === "link") return "system";
  if (typeof text === "string" && text.startsWith("[Системное сообщение]")) return "system";
  if (plainText && isAvitoSystemMessageText(plainText)) return "system";
  if (typeof text === "string" && isAvitoSystemMessageText(text)) return "system";

  const authorId = msg.author_id ?? msg.authorId ?? msg.user_id ?? msg.author?.id;
  if (authorId === 0 || authorId === "0") return "system";

  if (msg.direction === "out") return "operator";

  if (authorId != null) {
    return String(authorId) === accountUserId ? "operator" : "client";
  }

  if (msg.direction === "in") return "client";
  return null;
}

/** Убрать маркеры системного сообщения Авито (для текста клиента/оператора) */
export function stripAvitoDecorations(text: string): string {
  if (!text) return text;
  return text.trim().replace(/^\[Системное сообщение\]\s*/i, "").replace(/^ℹ️\s*/, "").trim();
}

/** Текст системного сообщения Авито для отображения в CRM */
export function formatAvitoMessageText(raw: string): string {
  if (!raw) return raw;
  const t = stripAvitoDecorations(raw);
  if (!t) return raw.trim();
  if (!t.startsWith("ℹ️")) return `ℹ️ ${t}`;
  return t;
}

export function isAvitoSystemMessageText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = stripAvitoDecorations(text);
  if (!t) return /^\[Системное сообщение\]|^ℹ️/.test(text.trim());
  if (isAvitoOrderSystemText(t)) return true;
  return /посмотрел номер|посмотрел ваш телефон|оставьте отзыв|покупатель указал авто|ассистент авито|совет для|заметили, что вы|(^|\s)я\s+оплатил($|[\s.!?,])|покупатель\s+перевёл|оплата\s+(прошла|получена)|подтвердите\s+получение|отправьте\s+заказ|курьер\s+назначен|заказ\s+доставлен|сообщение не поддерживается|предложение интересно|заинтересовало\s+(ваше\s+)?предложение|заинтересовался\s+в|пользователь\s+заинтересовался|как с вами связаться|создал\s+чат|чат\s+создан|задайте\s+вопрос|договоритесь\s+о\s+сделке|ничего\s+не\s+написал|напишите\s+первыми|ускорьте\s+вашу\s+сделку|нет\s+сообщений|ознакомился\s+с\s+вашей\s+скидк|ознакомился\s+с\s+скидк|пользователь\s+ознакомился/i.test(t);
}

/** Автоответ при «заинтересовалось ваше предложение» и похожих системных SMS Авито. */
export const AVITO_OFFER_INTEREST_AUTO_REPLY = `Добрый день, Вам актуально наше предложение?
если да пришлите вин код авто пожалуйста
наш номер для связи +7 968 449 6999`;

export function isAvitoOfferInterestSystemText(text: string | null | undefined): boolean {
  if (!text) return false;
  const t = stripAvitoDecorations(text).toLowerCase();
  return /заинтересовало\s+(ваше\s+)?предложение|предложение\s+интересно|заинтересовался\s+в\s+(вашем\s+)?предложении|пользователь\s+заинтересовался|заинтересован\s+в\s+вашем\s+предложении/i.test(t);
}

/** Системное уведомление Авито, которое должно подсветить диалог в inbox (не API-заглушка). */
export function isAvitoActionableSystemText(text: string | null | undefined): boolean {
  if (!text || !isAvitoSystemMessageText(text)) return false;
  const t = stripAvitoDecorations(text);
  return !/^Сообщение не поддерживается\.\s*Пожалуйста, перейдите в Авито мессенджер/i.test(t);
}

export function isUnsupportedAvitoPlaceholder(msg: any): boolean {
  const text = msg?.content?.text ?? msg?.text ?? "";
  return typeof text === "string" && text.includes("Сообщение не поддерживается");
}

/** Системное сообщение Авито о новом заказе */
export function isAvitoOrderSystemText(text: string): boolean {
  const t = text.toLowerCase();
  return /оформил\s+заказ|новый\s+заказ|заказ\s+№|заказ\s+оплачен|покупатель\s+оплатил|подтвердите\s+заказ|(^|\s)я\s+оплатил($|[\s.!?,])|оплата\s+прошла/.test(t);
}

export function mergeAvitoMetadata(existingJson: string | null | undefined, patch: AvitoItemContext & {
  avitoAccountName?: string;
  avitoChannelId?: number;
}): string {
  let base: Record<string, unknown> = {};
  if (existingJson) {
    try { base = JSON.parse(existingJson); } catch { /* ignore */ }
  }
  const merged = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v != null && v !== "") merged[k] = v;
  }
  return JSON.stringify(merged);
}
