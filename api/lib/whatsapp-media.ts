import { extname } from "node:path";
import type { ChannelConfig } from "./channel-config";
import { mimeFromExt, type MediaKind } from "./media";

export function parseWhatsAppMediaId(mediaUrl: string | null | undefined): string | null {
  if (!mediaUrl?.startsWith("whatsapp:")) return null;
  return mediaUrl.slice("whatsapp:".length) || null;
}

export async function downloadWhatsAppMedia(
  config: ChannelConfig,
  mediaId: string,
  mediaType?: MediaKind,
  originalName?: string,
): Promise<{ buffer: Buffer; filename: string; mime: string } | null> {
  if (!config.whatsappToken) return null;

  const metaRes = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(mediaId)}`, {
    headers: { Authorization: `Bearer ${config.whatsappToken}` },
  });
  const meta = await metaRes.json() as { url?: string; mime_type?: string; file_size?: number };
  if (!meta.url) return null;

  const fileRes = await fetch(meta.url, {
    headers: { Authorization: `Bearer ${config.whatsappToken}` },
  });
  if (!fileRes.ok) return null;

  const buffer = Buffer.from(await fileRes.arrayBuffer());
  const mime = meta.mime_type || fileRes.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  const ext = extname(originalName || "") || (
    mediaType === "video" ? ".mp4"
      : mediaType === "photo" ? ".jpg"
        : ".bin"
  );
  const filename = originalName?.trim() || `whatsapp-${mediaId.slice(0, 12)}${ext}`;
  return { buffer, filename, mime: mimeFromExt(extname(filename)) || mime };
}
