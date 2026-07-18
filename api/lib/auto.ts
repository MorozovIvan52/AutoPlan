/** Извлечь VIN из текста сообщения */
export function extractVin(text: string): string | null {
  const m = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/);
  return m ? m[0] : null;
}

/** Извлечь артикул (типичные форматы автозапчастей) */
export function extractArticle(text: string): string | null {
  const m = text.match(/\b([A-Z0-9][A-Z0-9\-/.]{4,20})\b/i);
  return m ? m[1].toUpperCase() : null;
}

export type AvitoContext = {
  itemId?: string;
  itemTitle?: string;
  itemPrice?: number;
  itemUrl?: string;
};

export function parseAvitoContext(body: any): AvitoContext {
  const value = body?.payload?.value ?? body?.value ?? body;
  const ctx = value?.context ?? value?.item ?? {};
  return {
    itemId: String(ctx.item_id ?? ctx.id ?? value?.item_id ?? ""),
    itemTitle: ctx.title ?? value?.item_title ?? value?.title,
    itemPrice: ctx.price ?? value?.price,
    itemUrl: ctx.url ?? value?.url,
  };
}
