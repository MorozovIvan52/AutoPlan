import { isYandexVisionConfigured, yandexOcrImageBuffer } from "./yandex-vision";

const OCR_ENABLED = process.env.MESSAGE_OCR_ENABLED !== "false";

let workerPromise: Promise<{
  recognize: (buf: Buffer) => Promise<{ data: { text: string } }>;
}> | null = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("rus+eng", 1, { logger: () => {} });
      return worker;
    })();
  }
  return workerPromise;
}

export function normalizeOcrText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

export type OcrEngine = "yandex" | "tesseract";

export type OcrImageResult = {
  text: string;
  engine: OcrEngine;
};

export function getPreferredOcrEngine(): OcrEngine | null {
  if (!OCR_ENABLED) return null;
  if (isYandexVisionConfigured()) return "yandex";
  return "tesseract";
}

async function tesseractOcr(buffer: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  return normalizeOcrText(data.text || "");
}

export async function ocrImageBuffer(buffer: Buffer, mimeHint?: string): Promise<OcrImageResult> {
  if (!OCR_ENABLED) throw new Error("OCR отключён на сервере");
  if (!buffer?.length) return { text: "", engine: "tesseract" };

  if (isYandexVisionConfigured()) {
    try {
      const text = normalizeOcrText(await yandexOcrImageBuffer(buffer, mimeHint));
      if (text) return { text, engine: "yandex" };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[ocr] Yandex Vision failed, fallback to Tesseract:", msg);
      if (process.env.OCR_TESSERACT_FALLBACK === "false") throw e;
    }
  }

  const text = await tesseractOcr(buffer);
  return { text, engine: "tesseract" };
}

/** Только текст (для чатов и обратной совместимости) */
export async function ocrImageBufferText(buffer: Buffer, mimeHint?: string): Promise<string> {
  const { text } = await ocrImageBuffer(buffer, mimeHint);
  return text;
}
