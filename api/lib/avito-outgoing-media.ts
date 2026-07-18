import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { sniffMimeFromBuffer, type MediaKind } from "./media";

const execFileAsync = promisify(execFile);

export type AvitoImagePayload = {
  buffer: Buffer;
  mime: string;
  filename: string;
};

function imageFilename(base: string, mime: string): string {
  const stem = base.replace(/\.[^.]+$/, "") || "image";
  if (mime.includes("png")) return `${stem}.png`;
  if (mime.includes("gif")) return `${stem}.gif`;
  if (mime.includes("webp")) return `${stem}.webp`;
  if (mime.includes("heic") || mime.includes("heif")) return `${stem}.heic`;
  return `${stem}.jpg`;
}

async function pdfFirstPageToJpeg(buffer: Buffer): Promise<Buffer | null> {
  const dir = mkdtempSync(join(tmpdir(), "crm-avito-pdf-"));
  const pdfPath = join(dir, "doc.pdf");
  const outBase = join(dir, "page");
  try {
    writeFileSync(pdfPath, buffer);
    await execFileAsync(
      "pdftoppm",
      ["-jpeg", "-r", "144", "-f", "1", "-l", "1", "-singlefile", pdfPath, outBase],
      { timeout: 45_000 },
    );
    return readFileSync(`${outBase}.jpg`);
  } catch {
    return null;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/** Готовит буфер для uploadImages Авито (только изображения; PDF → JPEG). */
export async function prepareAvitoImageUpload(
  buffer: Buffer,
  mime: string,
  filename: string,
  mediaType: MediaKind,
): Promise<AvitoImagePayload> {
  const sniffed = sniffMimeFromBuffer(buffer) || mime || "";

  if (sniffed.startsWith("image/") || mediaType === "photo") {
    const outMime = sniffed.startsWith("image/") ? sniffed : "image/jpeg";
    return {
      buffer,
      mime: outMime,
      filename: imageFilename(filename, outMime),
    };
  }

  if (sniffed === "application/pdf" || /\.pdf$/i.test(filename)) {
    const jpeg = await pdfFirstPageToJpeg(buffer);
    if (!jpeg) {
      throw new Error(
        "Не удалось подготовить PDF для Авито. На сервере нужен poppler-utils (pdftoppm), либо отправьте скриншот/фото документа.",
      );
    }
    return {
      buffer: jpeg,
      mime: "image/jpeg",
      filename: imageFilename(filename.replace(/\.pdf$/i, ""), "image/jpeg"),
    };
  }

  if (mediaType === "video") {
    throw new Error(
      "Авито API не поддерживает отправку видео. Отправьте скриншот как фото или используйте WhatsApp/Telegram.",
    );
  }

  throw new Error(
    "Этот тип файла нельзя отправить в Авито. Используйте фото (JPG/PNG) или PDF — он будет отправлен как изображение.",
  );
}
