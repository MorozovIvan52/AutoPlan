const API_URL = "https://llm.api.cloud.yandex.net/foundationModels/v1/completion";

export type YandexMessage = { role: "system" | "user" | "assistant"; text: string };

export function isYandexConfigured(): boolean {
  return Boolean(process.env.YANDEX_API_KEY?.trim() && process.env.YANDEX_FOLDER_ID?.trim());
}

export async function yandexCompletion(
  messages: YandexMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const apiKey = process.env.YANDEX_API_KEY;
  const folderId = process.env.YANDEX_FOLDER_ID;
  if (!apiKey || !folderId) {
    throw new Error("Яндекс GPT не настроен. Добавьте YANDEX_API_KEY и YANDEX_FOLDER_ID в .env (Yandex Cloud → AI Studio)");
  }

  const model = process.env.YANDEX_MODEL || "yandexgpt-lite";
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Api-Key ${apiKey}`,
      "x-folder-id": folderId,
    },
    body: JSON.stringify({
      modelUri: `gpt://${folderId}/${model}`,
      completionOptions: {
        stream: false,
        temperature: opts?.temperature ?? 0.5,
        maxTokens: String(opts?.maxTokens ?? 1500),
      },
      messages,
    }),
  });

  const data = await res.json() as {
    error?: { message?: string };
    result?: { alternatives?: { message?: { text?: string } }[] };
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `YandexGPT HTTP ${res.status}`);
  }

  const text = data.result?.alternatives?.[0]?.message?.text?.trim();
  if (!text) throw new Error("Пустой ответ от YandexGPT");
  return text;
}
