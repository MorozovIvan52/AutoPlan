export type TemplateMedia = {
  url: string;
  type: "photo" | "video" | "document";
};

export const MAX_TEMPLATE_MEDIA = 3;

export function mediaTypeFromUrl(url: string): TemplateMedia["type"] {
  const ext = (url.match(/\.([a-z0-9]+)(?:\?|$)/i)?.[1] || "").toLowerCase();
  if (["mp4", "mov", "webm", "avi", "mkv"].includes(ext)) return "video";
  if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) return "photo";
  return "document";
}

export function parseTemplateMediaUrls(raw: string | null | undefined): TemplateMedia[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && typeof m.url === "string")
      .map((m) => ({
        url: m.url,
        type: m.type === "video" || m.type === "document" ? m.type : "photo",
      }))
      .slice(0, MAX_TEMPLATE_MEDIA);
  } catch {
    return [];
  }
}

export function stringifyTemplateMediaUrls(items: TemplateMedia[]): string | null {
  const clean = items.filter((m) => m.url).slice(0, MAX_TEMPLATE_MEDIA);
  return clean.length ? JSON.stringify(clean) : null;
}

export function normalizeTemplateRow<T extends { imageUrl?: string | null; mediaUrls?: string | null }>(row: T) {
  let mediaUrls = parseTemplateMediaUrls(row.mediaUrls);
  if (!mediaUrls.length && row.imageUrl) {
    mediaUrls = [{ url: row.imageUrl, type: mediaTypeFromUrl(row.imageUrl) }];
  }
  return {
    ...row,
    mediaUrls,
    imageUrl: mediaUrls[0]?.url || row.imageUrl || null,
  };
}

export function templateMediaFromRow(t: { imageUrl?: string | null; mediaUrls?: TemplateMedia[] }): TemplateMedia[] {
  if (t.mediaUrls?.length) return t.mediaUrls;
  if (t.imageUrl) return [{ url: t.imageUrl, type: mediaTypeFromUrl(t.imageUrl) }];
  return [];
}
