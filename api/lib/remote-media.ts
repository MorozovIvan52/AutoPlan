import { basename } from "node:path";
import { saveUpload } from "./uploads";
import type { MediaKind } from "./media";
import { extFromMime } from "./media";

function httpFetchHeaders(url: string): Record<string, string> {
  return {
    "User-Agent": "Mozilla/5.0 (compatible; AutoServiceCRM/1.0)",
    Accept: "image/*,video/*,application/*,*/*",
    ...(url.includes("avito.") ? { Referer: "https://www.avito.ru/" } : {}),
  };
}

export async function fetchHttpMediaBuffer(
  url: string,
  mediaType?: MediaKind,
): Promise<{ buffer: Buffer; mime: string; filename: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: httpFetchHeaders(url) });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const urlName = basename(new URL(url).pathname) || "file";
    const extFromMimeVal = extFromMime(mime);
    const urlExt = (urlName.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    const knownExt = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".pdf", ".doc", ".docx", ".zip"].includes(urlExt);
    const filename = knownExt
      ? urlName
      : extFromMimeVal !== ".bin"
        ? `file${extFromMimeVal}`
        : mediaType === "photo"
          ? "photo.jpg"
          : mediaType === "video"
            ? "video.mp4"
            : "file.bin";

    return { buffer, mime, filename };
  } catch {
    return null;
  }
}

export async function cacheHttpMedia(
  url: string,
  mediaType?: MediaKind,
): Promise<{ url: string; mediaType: MediaKind; filename: string } | null> {
  try {
    const res = await fetch(url, { redirect: "follow", headers: httpFetchHeaders(url) });
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim() || "application/octet-stream";
    const urlName = basename(new URL(url).pathname) || "file";
    const extFromMime = mime.includes("jpeg") || mime.includes("jpg") ? ".jpg"
      : mime.includes("png") ? ".png"
      : mime.includes("webp") ? ".webp"
      : mime.includes("gif") ? ".gif"
      : mime.includes("mp4") ? ".mp4"
      : mime.includes("pdf") ? ".pdf"
      : "";
    const urlExt = (urlName.match(/\.[^.]+$/) || [""])[0].toLowerCase();
    const knownExt = [".jpg", ".jpeg", ".png", ".webp", ".gif", ".mp4", ".pdf", ".doc", ".docx", ".zip"].includes(urlExt);
    const filename = knownExt
      ? urlName
      : extFromMime
        ? `file${extFromMime}`
        : mediaType === "photo"
          ? "photo.jpg"
          : mediaType === "video"
            ? "video.mp4"
            : "file.bin";

    const saved = saveUpload(buffer, filename, mime);
    return { url: saved.url, mediaType: saved.mediaType, filename: saved.filename };
  } catch {
    return null;
  }
}
