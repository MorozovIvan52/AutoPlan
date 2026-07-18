export type MediaKind = "photo" | "video" | "document";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".avi", ".mkv"]);
const DOC_EXT = new Set([
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".txt", ".csv",
  ".zip", ".rar", ".7z", ".rtf", ".odt",
]);

const MIME_MAP: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".avi": "video/x-msvideo",
  ".mkv": "video/x-matroska",
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".zip": "application/zip",
  ".rar": "application/vnd.rar",
  ".7z": "application/x-7z-compressed",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
};

export function mimeFromExt(ext: string): string {
  return MIME_MAP[ext.toLowerCase()] || "application/octet-stream";
}

export function sniffMimeFromBuffer(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "image/png";
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return "image/gif";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (buffer[4] === 0x66 && buffer[5] === 0x74 && buffer[6] === 0x79 && buffer[7] === 0x70) return "video/mp4";
  if (buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46) return "application/pdf";
  return null;
}

export function extFromMime(mime: string): string {
  if (mime.includes("jpeg") || mime.includes("jpg")) return ".jpg";
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  if (mime.includes("gif")) return ".gif";
  if (mime.includes("heic") || mime.includes("heif")) return ".heic";
  if (mime.includes("mp4")) return ".mp4";
  if (mime.includes("pdf")) return ".pdf";
  return ".bin";
}

export function detectMediaKind(filename: string, mime?: string): MediaKind | null {
  const ext = (filename.match(/\.[^.]+$/) || [""])[0].toLowerCase();
  if (IMAGE_EXT.has(ext) || mime?.startsWith("image/")) return "photo";
  if (VIDEO_EXT.has(ext) || mime?.startsWith("video/")) return "video";
  if (DOC_EXT.has(ext) || mime?.startsWith("application/") || mime?.startsWith("text/")) return "document";
  return null;
}

export function mediaPlaceholder(kind: MediaKind): string {
  if (kind === "photo") return "[фото]";
  if (kind === "video") return "[видео]";
  return "[файл]";
}

export function maxBytesForKind(kind: MediaKind): number {
  const imgMb = Number(process.env.CRM_UPLOAD_MAX_MB || 8);
  const videoMb = Number(process.env.CRM_VIDEO_MAX_MB || 24);
  const docMb = Number(process.env.CRM_DOC_MAX_MB || 20);
  if (kind === "photo") return imgMb * 1024 * 1024;
  if (kind === "video") return videoMb * 1024 * 1024;
  return docMb * 1024 * 1024;
}

export function allAllowedExtensions(): string[] {
  return [...IMAGE_EXT, ...VIDEO_EXT, ...DOC_EXT];
}

/** Имя файла для загрузки — на мобильных часто приходит без расширения */
export function normalizeUploadFilename(name: string, mime?: string): string {
  const trimmed = name?.trim() || "";
  if (trimmed && /\.[a-z0-9]{2,5}$/i.test(trimmed) && trimmed !== "blob") return trimmed;
  const ext = mime ? extFromMime(mime) : ".bin";
  const base = trimmed && trimmed !== "blob" ? trimmed.replace(/\.[^.]+$/, "") : "file";
  return `${base}${ext}`;
}
