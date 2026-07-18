import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { parseConfig } from "./channel-config";
import { getAvitoToken, pickAvitoImageUrl } from "../integrations/avito";

const AVITO_API = process.env.AVITO_API_BASE || "https://api.avito.ru";

export function isAvitoHttpUrl(url: string | null | undefined): boolean {
  return !!url && /^https?:\/\//i.test(url) && url.includes("avito.");
}

function pickAvitoMediaUrl(content: Record<string, unknown>): string | null {
  const image = content.image as { sizes?: Record<string, string> } | string | undefined;
  if (image && typeof image === "object" && image.sizes) {
    return pickAvitoImageUrl(image.sizes) ?? null;
  }
  if (typeof image === "string" && image.startsWith("http")) return image;

  const video = content.video as { url?: string; sizes?: Record<string, string> } | string | undefined;
  if (typeof video === "string" && video.startsWith("http")) return video;
  if (video && typeof video === "object") {
    if (typeof video.url === "string" && video.url.startsWith("http")) return video.url;
    if (video.sizes) return pickAvitoImageUrl(video.sizes) ?? null;
  }

  const file = content.file as { url?: string } | string | undefined;
  if (typeof file === "string" && file.startsWith("http")) return file;
  if (file && typeof file === "object" && typeof file.url === "string") return file.url;

  const voice = content.voice as { url?: string; voice_id?: string; id?: string } | string | undefined;
  if (typeof voice === "string" && voice.startsWith("http")) return voice;
  if (voice && typeof voice === "object" && typeof voice.url === "string" && voice.url.startsWith("http")) {
    return voice.url;
  }

  return null;
}

export function parseAvitoVoiceId(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl) return null;
  const m = mediaUrl.match(/^avito:voice:(.+)$/);
  return m ? m[1] : null;
}

function extractVoiceIdFromRaw(raw: Record<string, unknown>): string | null {
  const content = (raw.content ?? raw.message ?? {}) as Record<string, unknown>;
  const voice = content.voice as { voice_id?: string; id?: string } | string | undefined;
  if (voice && typeof voice === "object") {
    const id = voice.voice_id ?? voice.id;
    if (id != null) return String(id);
  }
  const voiceId = content.voice_id ?? raw.voice_id;
  if (voiceId != null) return String(voiceId);
  const msgId = avitoMessageId(raw);
  return msgId || null;
}

export async function fetchAvitoVoiceDownloadUrl(
  channelId: number,
  voiceId: string,
): Promise<string | null> {
  const auth = await fetchAvitoAuth(channelId);
  if (!auth) return null;

  try {
    const res = await fetch(`${AVITO_API}/messenger/v1/accounts/${auth.userId}/getVoiceFiles`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ voice_ids: [voiceId] }),
    });
    if (!res.ok) return null;
    const data = await res.json() as Record<string, unknown>;

    const urls = data.urls as Record<string, string> | undefined;
    if (urls && typeof urls === "object") {
      if (typeof urls[voiceId] === "string") return urls[voiceId];
      const first = Object.values(urls).find((v) => typeof v === "string" && v.startsWith("http"));
      if (first) return first;
    }

    const result = data.result as Record<string, string> | undefined;
    if (result && typeof result === "object") {
      if (typeof result[voiceId] === "string") return result[voiceId];
      const first = Object.values(result).find((v) => typeof v === "string" && v.startsWith("http"));
      if (first) return first;
    }

    if (Array.isArray(data)) {
      const item = data.find((x) => {
        const row = x as { voice_id?: string; id?: string; url?: string };
        return row.voice_id === voiceId || row.id === voiceId;
      }) as { url?: string } | undefined;
      if (item?.url) return item.url;
    }
  } catch {
    return null;
  }
  return null;
}

export async function downloadAvitoVoice(
  channelId: number,
  voiceId: string,
): Promise<{ buffer: Buffer; mime: string; filename: string } | null> {
  const url = await fetchAvitoVoiceDownloadUrl(channelId, voiceId);
  if (!url) return null;

  const res = await fetch(url);
  if (!res.ok) return null;
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "audio/mpeg";
  const ext = mime.includes("ogg") ? ".ogg" : mime.includes("wav") ? ".wav" : ".mp3";
  return { buffer, mime, filename: `voice-${voiceId.slice(0, 12)}${ext}` };
}

export async function refreshAvitoVoiceRef(
  channelId: number,
  chatId: string,
  externalMessageId: string,
): Promise<string | null> {
  const raw = await fetchAvitoMessageRaw(channelId, chatId, externalMessageId);
  if (!raw) return null;
  const voiceId = extractVoiceIdFromRaw(raw);
  return voiceId ? `avito:voice:${voiceId}` : null;
}

function avitoMessageId(msg: Record<string, unknown>): string {
  return String(msg.id ?? msg.message_id ?? "");
}

function extractMessagesPayload(data: unknown): unknown[] {
  if (!data || typeof data !== "object") return [];
  const obj = data as { messages?: unknown[]; result?: unknown[] };
  if (Array.isArray(obj.messages)) return obj.messages;
  if (Array.isArray(obj.result)) return obj.result;
  if (Array.isArray(data)) return data;
  return [];
}

async function fetchAvitoAuth(channelId: number): Promise<{ token: string; userId: string } | null> {
  const [channel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channelId));
  if (!channel?.type || channel.type !== "avito") return null;

  const config = parseConfig(channel.config);
  if (!config.userId) return null;

  const { token } = await getAvitoToken(config);
  return { token, userId: String(config.userId) };
}

export async function fetchAvitoMessageRaw(
  channelId: number,
  chatId: string,
  externalMessageId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const auth = await fetchAvitoAuth(channelId);
    if (!auth) return null;

    const { token, userId } = auth;
    const directUrls = [
      `${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/messages/${externalMessageId}`,
      `${AVITO_API}/messenger/v3/accounts/${userId}/chats/${chatId}/messages/${externalMessageId}`,
    ];

    for (const url of directUrls) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) continue;
      const data = await res.json() as Record<string, unknown>;
      if (data && typeof data === "object" && avitoMessageId(data)) return data;
    }

    const listEndpoints = [
      (offset: number) => `${AVITO_API}/messenger/v3/accounts/${userId}/chats/${chatId}/messages/?limit=100&offset=${offset}`,
      (offset: number) => `${AVITO_API}/messenger/v1/accounts/${userId}/chats/${chatId}/messages?limit=100&offset=${offset}`,
    ];

    for (const buildUrl of listEndpoints) {
      for (let offset = 0; offset < 1000; offset += 100) {
        const res = await fetch(buildUrl(offset), { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) break;

        const messages = extractMessagesPayload(await res.json());
        if (!messages.length) break;

        const found = messages.find((m) => avitoMessageId(m as Record<string, unknown>) === externalMessageId);
        if (found) return found as Record<string, unknown>;

        if (messages.length < 100) break;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export async function refreshAvitoImageUrl(
  channelId: number,
  chatId: string,
  externalMessageId: string,
): Promise<string | null> {
  const raw = await fetchAvitoMessageRaw(channelId, chatId, externalMessageId);
  if (!raw) return null;

  const content = (raw.content ?? raw.message ?? {}) as Record<string, unknown>;
  return pickAvitoMediaUrl(content);
}
