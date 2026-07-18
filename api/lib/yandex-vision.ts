const OCR_URL = "https://ocr.api.cloud.yandex.net/ocr/v1/recognizeText";

export function isYandexVisionConfigured(): boolean {
  if (process.env.YANDEX_VISION_ENABLED === "false") return false;
  return Boolean(process.env.YANDEX_API_KEY?.trim());
}

function mimeToYandexType(mime?: string): string {
  if (!mime) return "JPEG";
  const m = mime.toLowerCase();
  if (m.includes("png")) return "PNG";
  if (m.includes("webp")) return "WEBP";
  if (m.includes("heic")) return "HEIC";
  if (m.includes("heif")) return "HEIF";
  if (m.includes("pdf")) return "PDF";
  return "JPEG";
}

function extractTextFromResponse(data: Record<string, unknown>): string {
  const result = data.result as Record<string, unknown> | undefined;
  const ta = result?.textAnnotation as Record<string, unknown> | undefined;
  if (typeof ta?.fullText === "string" && ta.fullText.trim()) return ta.fullText;

  const parts: string[] = [];
  for (const block of (ta?.blocks as Record<string, unknown>[] | undefined) || []) {
    for (const line of (block?.lines as Record<string, unknown>[] | undefined) || []) {
      if (typeof line?.text === "string" && line.text.trim()) {
        parts.push(line.text.trim());
        continue;
      }
      const words = (line?.words as { text?: string }[] | undefined) || [];
      const lineText = words.map((w) => w.text || "").join(" ").trim();
      if (lineText) parts.push(lineText);
    }
  }
  return parts.join("\n");
}

export async function yandexOcrImageBuffer(buffer: Buffer, mimeHint?: string): Promise<string> {
  const apiKey = process.env.YANDEX_API_KEY?.trim();
  if (!apiKey) throw new Error("YANDEX_API_KEY не задан");

  const folderId = process.env.YANDEX_FOLDER_ID?.trim();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Api-Key ${apiKey}`,
    "x-data-logging-enabled": "true",
  };
  if (folderId) headers["x-folder-id"] = folderId;

  const res = await fetch(OCR_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      mimeType: mimeToYandexType(mimeHint),
      languageCodes: ["ru", "en"],
      model: process.env.YANDEX_VISION_MODEL || "page",
      content: buffer.toString("base64"),
    }),
  });

  const data = await res.json() as Record<string, unknown> & {
    message?: string;
    error?: string;
  };

  if (!res.ok) {
    throw new Error(data.message || data.error || `Yandex Vision HTTP ${res.status}`);
  }

  const text = extractTextFromResponse(data);
  if (!text.trim()) throw new Error("Yandex Vision не нашёл текст на изображении");
  return text;
}
