export type TemplateMedia = {
  url: string;
  type: "photo" | "video" | "document";
};

export const MAX_TEMPLATE_MEDIA = 3;

export function mediaTypeFromFile(file: File): TemplateMedia["type"] {
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("image/")) return "photo";
  return "document";
}

export function mediaTypeFromUrl(url: string): TemplateMedia["type"] {
  const ext = (url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "").toLowerCase();
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "photo";
  return "document";
}

export function templateMediaFromRow(t: { imageUrl?: string | null; mediaUrls?: TemplateMedia[] }): TemplateMedia[] {
  if (t.mediaUrls?.length) return t.mediaUrls;
  if (t.imageUrl) return [{ url: t.imageUrl, type: mediaTypeFromUrl(t.imageUrl) }];
  return [];
}
