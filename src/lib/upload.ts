import { parseApiResponse } from "./api-errors";
import type { TemplateMedia } from "./template-media";
import { mediaTypeFromUrl } from "./template-media";

export async function uploadImageFile(file: File): Promise<string> {
  return uploadMediaFile(file);
}

export async function uploadMediaFile(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/uploads", { method: "POST", body: fd, credentials: "include" });
  const data = await parseApiResponse<{ url: string }>(res);
  return data.url;
}

/** Загрузить файл и сразу отправить в диалог (один запрос) */
export async function sendConversationFile(
  conversationId: number,
  file: File,
  text = "",
): Promise<{ deliveryNote?: string }> {
  const fd = new FormData();
  fd.append("file", file);
  if (text.trim()) fd.append("text", text.trim());
  const res = await fetch(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  return parseApiResponse(res);
}

/** Отправить текст и вложения шаблона (первое фото — с текстом как подпись) */
export async function sendConversationTemplate(
  conversationId: number,
  text: string,
  media: TemplateMedia[],
): Promise<void> {
  const trimmed = text.trim();
  const items = media.filter((m) => m?.url);

  if (!trimmed && !items.length) return;

  const postMessage = async (payload: { text?: string; mediaUrl?: string; mediaType?: TemplateMedia["type"] }) => {
    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: payload.text || "",
        mediaUrl: payload.mediaUrl,
        mediaType: payload.mediaUrl
          ? (payload.mediaType || mediaTypeFromUrl(payload.mediaUrl))
          : undefined,
      }),
      credentials: "include",
    });
    await parseApiResponse(res);
  };

  if (items.length) {
    await postMessage({ text: trimmed, mediaUrl: items[0].url, mediaType: items[0].type });
    for (let i = 1; i < items.length; i++) {
      await new Promise((r) => setTimeout(r, 700));
      await postMessage({ text: "", mediaUrl: items[i].url, mediaType: items[i].type });
    }
  } else if (trimmed) {
    await postMessage({ text: trimmed });
  }
}

/** @deprecated используйте sendConversationFile */
export const sendConversationPhoto = sendConversationFile;
