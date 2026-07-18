import { yandexCompletion, isYandexConfigured, type YandexMessage } from "./yandex-gpt";

export type LlmMessage = YandexMessage;

/** OpenAI-compatible (cheat-ai / Anthropic proxy) — приоритетнее YandexGPT */
export function isOpenAiCompatConfigured(): boolean {
  return Boolean(process.env.AI_API_KEY?.trim() && process.env.AI_BASE_URL?.trim());
}

export function isLlmConfigured(): boolean {
  return isOpenAiCompatConfigured() || isYandexConfigured();
}

export function llmProvider(): "openai-compat" | "yandex" | "none" {
  if (isOpenAiCompatConfigured()) return "openai-compat";
  if (isYandexConfigured()) return "yandex";
  return "none";
}

export function llmModelLabel(): string {
  if (isOpenAiCompatConfigured()) {
    return process.env.AI_MODEL?.trim() || "claude-opus-4-8";
  }
  return process.env.YANDEX_MODEL || "yandexgpt-lite";
}

function openaiCompatBase(): string {
  const base = (process.env.AI_BASE_URL || "").trim().replace(/\/+$/, "");
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

async function openAiCompatCompletion(
  messages: LlmMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  const apiKey = process.env.AI_API_KEY!.trim();
  const model = process.env.AI_MODEL?.trim() || "claude-opus-4-8";
  const url = `${openaiCompatBase()}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: opts?.temperature ?? 0.5,
      max_tokens: opts?.maxTokens ?? 4096,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.text,
      })),
    }),
  });

  const data = await res.json() as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };

  if (!res.ok) {
    throw new Error(data.error?.message || `AI HTTP ${res.status}`);
  }

  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Пустой ответ от AI");
  return text;
}

/** Единая точка вызова LLM: AI_* (OpenAI-compat) → иначе YandexGPT */
export async function llmCompletion(
  messages: LlmMessage[],
  opts?: { temperature?: number; maxTokens?: number },
): Promise<string> {
  if (isOpenAiCompatConfigured()) {
    return openAiCompatCompletion(messages, opts);
  }
  if (isYandexConfigured()) {
    return yandexCompletion(messages, opts);
  }
  throw new Error(
    "AI не настроен. Добавьте AI_API_KEY + AI_BASE_URL (Claude/OpenAI-compat) или YANDEX_API_KEY + YANDEX_FOLDER_ID",
  );
}
