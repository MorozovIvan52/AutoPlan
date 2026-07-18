import type { ChannelConfig } from "../lib/channel-config";
import { extractAvitoItemFromMessage, isAvitoAccountLabel } from "../lib/avito-context";
import { fetchAvitoApi, formatAvitoApiError } from "../lib/avito-fetch";

const AVITO_API = "https://api.avito.ru";

export async function getAvitoToken(config: ChannelConfig): Promise<{ token: string; config: ChannelConfig }> {
  const now = Date.now();
  if (config.accessToken && config.tokenExpiresAt && config.tokenExpiresAt > now + 60_000) {
    return { token: config.accessToken, config };
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Укажите Client ID и Client Secret Авито");
  }
  const res = await fetchAvitoApi(`${AVITO_API}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret,
    }),
  });
  const data = await res.json() as any;
  if (!data.access_token) throw new Error(data.error_description || data.error || "Ошибка OAuth Авито");
  const updated: ChannelConfig = {
    ...config,
    accessToken: data.access_token,
    tokenExpiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return { token: data.access_token, config: updated };
}

const AVITO_API_BASE = process.env.AVITO_API_BASE || AVITO_API;

/** Чат из Messenger API (участники, контекст объявления). */
export async function fetchAvitoChat(
  config: ChannelConfig,
  chatId: string,
): Promise<any | null> {
  try {
    const { token } = await getAvitoToken(config);
    const userId = String(config.userId);
    const res = await fetchAvitoApi(
      `${AVITO_API_BASE}/messenger/v2/accounts/${userId}/chats/${chatId}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data?.chat ?? data ?? null;
  } catch {
    return null;
  }
}

export async function validateAvito(config: ChannelConfig): Promise<{ ok: boolean; error?: string; config?: ChannelConfig }> {
  try {
    if (!config.clientId || !config.clientSecret) return { ok: false, error: "Client ID и Client Secret обязательны" };
    if (!config.userId) return { ok: false, error: "Укажите User ID аккаунта Авито (из API)" };
    const { config: updated } = await getAvitoToken(config);
    const res = await fetchAvitoApi(`${AVITO_API}/core/v1/accounts/self`, {
      headers: { Authorization: `Bearer ${updated.accessToken}` },
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Авито API: ${res.status} ${err.slice(0, 120)}` };
    }
    return { ok: true, config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendAvitoMessage(
  config: ChannelConfig,
  chatId: string,
  text: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string; config?: ChannelConfig }> {
  try {
    const { token, config: updated } = await getAvitoToken(config);
    const userId = config.userId!;
    const res = await fetchAvitoApi(`${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        message: { text },
        type: "text",
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Авито: ${formatAvitoApiError(res.status, err)}`, config: updated };
    }
    const data = await res.json() as any;
    const externalMessageId = String(data?.id ?? data?.message?.id ?? data?.message_id ?? "");
    return { ok: true, externalMessageId, config: updated };
  } catch (e: any) {
    return { ok: false, error: `Авито: ${formatAvitoApiError(503, e?.message || "")}` };
  }
}

/** Проверяет, что исходящее сообщение реально появилось в API Авито. */
export async function verifyAvitoMessageDelivered(
  config: ChannelConfig,
  chatId: string,
  externalMessageId: string,
): Promise<boolean> {
  if (!externalMessageId?.trim()) return false;
  try {
    const { token } = await getAvitoToken(config);
    const userId = String(config.userId);
    const res = await fetchAvitoApi(
      `${AVITO_API_BASE}/messenger/v3/accounts/${userId}/chats/${encodeURIComponent(chatId)}/messages/?limit=20`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return false;
    const data = await res.json() as any;
    const messages = data?.messages ?? data?.result ?? [];
    return messages.some(
      (m: any) => String(m.id) === externalMessageId && (m.direction === "out" || String(m.author_id) === userId),
    );
  } catch {
    return false;
  }
}

function extractAvitoImageId(data: unknown): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;

  if (typeof obj.image_id === "string") return obj.image_id;
  if (typeof obj.imageId === "string") return obj.imageId;

  for (const key of ["images", "items", "result"]) {
    const arr = obj[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;
    const item = arr[0];
    if (typeof item === "string") return item;
    if (item && typeof item === "object") {
      const row = item as Record<string, unknown>;
      const id = row.image_id ?? row.imageId ?? row.id;
      if (id != null) return String(id);
    }
  }

  // Фактический формат API: { "userId.hash": { "1280x960": "url", ... } }
  const keys = Object.keys(obj).filter((k) => k !== "error");
  if (keys.length > 0) {
    const first = obj[keys[0]];
    if (first && typeof first === "object" && !Array.isArray(first)) {
      return keys[0];
    }
  }

  return undefined;
}

export async function uploadAvitoImage(
  config: ChannelConfig,
  fileBuffer: Buffer,
  filename: string,
  mimeType: string,
): Promise<{ ok: boolean; imageId?: string; error?: string; config?: ChannelConfig }> {
  try {
    const { token, config: updated } = await getAvitoToken(config);
    const userId = config.userId!;

    const form = new FormData();
    const blob = new Blob([new Uint8Array(fileBuffer)], { type: mimeType });
    form.append("uploadfile[]", blob, filename);

    const res = await fetchAvitoApi(`${AVITO_API}/messenger/v1/accounts/${userId}/uploadImages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Авито upload: ${formatAvitoApiError(res.status, err)}`, config: updated };
    }

    const data = await res.json();
    const imageId = extractAvitoImageId(data);

    if (!imageId) {
      const preview = JSON.stringify(data).slice(0, 200);
      return { ok: false, error: `Авито не вернул image_id (${preview})`, config: updated };
    }
    return { ok: true, imageId, config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function sendAvitoImage(
  config: ChannelConfig,
  chatId: string,
  imageId: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string; config?: ChannelConfig }> {
  try {
    const { token, config: updated } = await getAvitoToken(config);
    const userId = config.userId!;
    const res = await fetchAvitoApi(`${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/messages/image`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ image_id: imageId }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Авито image: ${formatAvitoApiError(res.status, err)}`, config: updated };
    }
    const data = await res.json() as any;
    return { ok: true, externalMessageId: String(data?.id || ""), config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function setupAvitoWebhook(config: ChannelConfig, webhookUrl: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const { token } = await getAvitoToken(config);
    const url = config.webhookSecret?.trim()
      ? `${webhookUrl}${webhookUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(config.webhookSecret.trim())}`
      : webhookUrl;
    const body: Record<string, string> = { url };
    if (config.webhookSecret) body.secret = config.webhookSecret;

    const res = await fetch(`${AVITO_API}/messenger/v3/webhook`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Webhook: ${res.status} ${err.slice(0, 200)}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function markAvitoChatRead(
  config: ChannelConfig,
  chatId: string,
): Promise<{ ok: boolean; error?: string; config?: ChannelConfig }> {
  try {
    const { token, config: updated } = await getAvitoToken(config);
    const userId = config.userId!;
    const res = await fetch(`${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/read`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Авито read: ${res.status} ${err.slice(0, 120)}`, config: updated };
    }
    return { ok: true, config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/** Удалить своё сообщение в чате Авито (доступно ~1 час после отправки). */
export async function deleteAvitoMessage(
  config: ChannelConfig,
  chatId: string,
  messageId: string,
): Promise<{ ok: boolean; error?: string; config?: ChannelConfig }> {
  try {
    const { token, config: updated } = await getAvitoToken(config);
    const userId = config.userId!;
    const url = `${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/messages/${messageId}`;
    let res = await fetch(url, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 405 || res.status === 404) {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    if (!res.ok) {
      const err = await res.text();
      return { ok: false, error: `Авито delete: ${res.status} ${err.slice(0, 200)}`, config: updated };
    }
    return { ok: true, config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export type AvitoCpaBalance = {
  advance: number;
  balance: number;
  debt: number;
};

/** balance и debt в CPA balanceInfo — в копейках. */
function kopecksToRubles(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value / 100;
}

/** balance — баланс CPA (аванс за просмотры в кабинете Авито), в копейках. */
/** advance — служебное поле API, не путать с балансом тарифа. */
function normalizeCpaAdvance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= 1000) return value / 100;
  return value;
}

export type AvitoAccountWallet = {
  real: number;
  bonus: number;
  total: number;
};

export async function getAvitoAccountWallet(
  config: ChannelConfig,
): Promise<{ ok: boolean; data?: AvitoAccountWallet; error?: string; config?: ChannelConfig }> {
  try {
    if (!config.userId) return { ok: false, error: "Не указан User ID Авито" };
    const { token, config: updated } = await getAvitoToken(config);
    const res = await fetch(`${AVITO_API}/core/v1/accounts/${config.userId}/balance/`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Авито кошелёк: ${res.status} ${raw.slice(0, 120)}`, config: updated };
    }
    const parsed = JSON.parse(raw) as { real?: number; bonus?: number };
    const real = Number(parsed.real ?? 0);
    const bonus = Number(parsed.bonus ?? 0);
    return { ok: true, data: { real, bonus, total: real + bonus }, config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getAvitoCpaBalance(
  config: ChannelConfig,
): Promise<{ ok: boolean; data?: AvitoCpaBalance; error?: string; config?: ChannelConfig }> {
  try {
    const { token, config: updated } = await getAvitoToken(config);
    const res = await fetch(`${AVITO_API}/cpa/v2/balanceInfo`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Source": "AutoServiceCRM",
      },
      body: "{}",
    });
    const raw = await res.text();
    if (!res.ok) {
      return { ok: false, error: `Авито CPA: ${res.status} ${raw.slice(0, 200)}`, config: updated };
    }
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      return { ok: false, error: "Авито CPA: неверный ответ", config: updated };
    }
    const result = parsed?.result ?? parsed;
    const advance = normalizeCpaAdvance(Number(result?.advance ?? 0));
    const balance = kopecksToRubles(Number(result?.balance ?? 0));
    const debt = kopecksToRubles(Number(result?.debt ?? 0));
    return { ok: true, data: { advance, balance, debt }, config: updated };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function getAvitoSubscriptions(config: ChannelConfig) {
  const { token } = await getAvitoToken(config);
  const res = await fetch(`${AVITO_API}/messenger/v1/subscriptions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  return res.json();
}

export function pickAvitoImageUrl(sizes: Record<string, string> | undefined): string | undefined {
  if (!sizes || typeof sizes !== "object") return undefined;
  const preferred = ["1280x960", "640x480", "140x105", "32x32"];
  for (const key of preferred) {
    if (typeof sizes[key] === "string" && sizes[key]) return sizes[key];
  }
  let bestUrl: string | undefined;
  let bestArea = 0;
  for (const [key, url] of Object.entries(sizes)) {
    if (typeof url !== "string" || !url) continue;
    const match = key.match(/(\d+)x(\d+)/);
    const area = match ? Number(match[1]) * Number(match[2]) : 0;
    if (area >= bestArea) {
      bestArea = area;
      bestUrl = url;
    }
  }
  return bestUrl || Object.values(sizes).find((v) => typeof v === "string" && v);
}

export function parseAvitoWebhook(body: any) {
  const payloadType = body?.payload?.type;
  if (payloadType && payloadType !== "message") return null;

  const value = body?.payload?.value ?? body?.value ?? body;
  if (!value) return null;
  const author = value.author ?? value.user ?? {};
  const authorName = author.name || author.profile_name || "";
  const safeAuthorName = authorName && !isAvitoAccountLabel(authorName) ? authorName : "";
  const content = value.content ?? value.message ?? {};
  const chatId = value.chat_id ?? value.chatId ?? value.id;
  if (!chatId) return null;

  const item = extractAvitoItemFromMessage(value);
  const msgType = value.type ?? content.type;
  const isImage = msgType === "image" || Boolean(content.image || content.image_id || value.image);
  const isVideo = msgType === "video" || Boolean(content.video || value.video);
  const isVoice = msgType === "voice" || Boolean(content.voice || content.voice_id || value.voice);
  const isFile = msgType === "file" || Boolean(content.file || value.file);

  let mediaUrl: string | undefined;
  if (content.image?.sizes) {
    mediaUrl = pickAvitoImageUrl(content.image.sizes);
  } else if (typeof content.image === "string" && content.image.startsWith("http")) {
    mediaUrl = content.image;
  } else if (value.image?.sizes) {
    mediaUrl = pickAvitoImageUrl(value.image.sizes);
  } else if (typeof content.video === "string" && content.video.startsWith("http")) {
    mediaUrl = content.video;
  } else if (content.video?.url) {
    mediaUrl = content.video.url;
  } else if (typeof content.file === "string" && content.file.startsWith("http")) {
    mediaUrl = content.file;
  } else if (content.file?.url) {
    mediaUrl = content.file.url;
  }

  if (isVoice && !mediaUrl) {
    const voiceObj = content.voice as { voice_id?: string; id?: string; url?: string } | string | undefined;
    const voiceId = (voiceObj && typeof voiceObj === "object"
      ? (voiceObj.voice_id ?? voiceObj.id)
      : undefined)
      ?? content.voice_id
      ?? value.voice_id
      ?? value.id
      ?? value.message_id;
    if (voiceId != null) mediaUrl = `avito:voice:${voiceId}`;
  }

  const mediaType = isVideo ? "video" as const
    : isVoice ? "document" as const
    : isImage ? "photo" as const
    : isFile ? "document" as const
    : undefined;

  let text = content.text ?? value.text ?? value.body?.text ?? "";
  if (!text.trim()) {
    if (isVideo) text = "[видео]";
    else if (isImage) text = "[фото]";
    else if (isVoice) text = "[голосовое]";
    else if (isFile) text = "[файл]";
    else if (item.avitoItemTitle) text = `Интерес к: ${item.avitoItemTitle}`;
    else if (mediaType) text = "[медиа]";
  }

  if ((isFile || isVoice) && !mediaUrl) {
    text = isVoice
      ? "🎤 Голосовое сообщение (откройте чат в приложении Авито)"
      : "📎 Клиент приложил файл — API Авито не передаёт содержимое. Откройте диалог в приложении Авито или попросите отправить фото/PDF в WhatsApp.";
  } else if (isVoice) {
    text = "[голосовое]";
  }

  return {
    externalUserId: String(author.id ?? author.user_id ?? "unknown"),
    externalChatId: String(chatId),
    senderName: safeAuthorName || "Клиент Авито",
    text,
    externalMessageId: String(value.id ?? value.message_id ?? ""),
    mediaUrl,
    mediaType,
    avitoItemId: item.avitoItemId,
    avitoItemTitle: item.avitoItemTitle,
    avitoPrice: item.avitoPrice,
    avitoItemUrl: item.avitoItemUrl,
  };
}
