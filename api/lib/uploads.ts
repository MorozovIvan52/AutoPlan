import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

import { join, extname, basename } from "node:path";

import { randomUUID } from "node:crypto";

import {

  detectMediaKind,

  maxBytesForKind,

  mimeFromExt,

  sniffMimeFromBuffer,

  type MediaKind,

} from "./media";



const UPLOAD_DIR = process.env.CRM_UPLOAD_DIR || join(process.cwd(), "uploads");



export function ensureUploadDir() {

  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

}



export function uploadDir() {

  ensureUploadDir();

  return UPLOAD_DIR;

}



export function saveUpload(

  buffer: Buffer,

  originalName: string,

  mimeHint?: string,

): { filename: string; url: string; mime: string; mediaType: MediaKind } {

  ensureUploadDir();

  const ext = extname(originalName).toLowerCase() || ".bin";

  const kind = detectMediaKind(originalName, mimeHint);

  if (!kind) {

    throw new Error("Формат не поддерживается. Допустимы: фото, видео (mp4, mov), документы (pdf, doc, xls, zip…)");

  }



  const maxBytes = maxBytesForKind(kind);

  if (buffer.length > maxBytes) {

    throw new Error(`Файл больше ${maxBytes / 1024 / 1024} МБ`);

  }



  const filename = `${randomUUID()}${ext}`;

  const full = join(UPLOAD_DIR, filename);

  writeFileSync(full, buffer);



  const mime = mimeHint && mimeHint !== "application/octet-stream"

    ? mimeHint

    : mimeFromExt(ext);



  return { filename, url: `/api/uploads/${filename}`, mime, mediaType: kind };

}



export function readUpload(filename: string): { buffer: Buffer; mime: string; mediaType: MediaKind } | null {

  const safe = basename(filename);

  if (safe !== filename || safe.includes("..")) return null;

  const full = join(UPLOAD_DIR, safe);

  if (!existsSync(full)) return null;

  const buffer = readFileSync(full);
  const ext = extname(safe).toLowerCase();
  const sniffed = sniffMimeFromBuffer(buffer);
  const mime = sniffed || mimeFromExt(ext);
  const mediaType = detectMediaKind(safe, mime) || (sniffed?.startsWith("image/") ? "photo" : sniffed?.startsWith("video/") ? "video" : "document");

  return { buffer, mime, mediaType };

}



export function resolveUploadPath(mediaUrl: string): {

  buffer: Buffer;

  mime: string;

  filename: string;

  mediaType: MediaKind;

} | null {

  const match = mediaUrl.match(/\/api\/uploads\/([^?#]+)/);

  if (!match) return null;

  const data = readUpload(match[1]);

  if (!data) return null;

  return { ...data, filename: match[1] };

}


