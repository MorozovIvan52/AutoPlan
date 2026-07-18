/**
 * Live-проценка от API поставщиков (Rossko, Emex — при наличии ключей в .env).
 */
import type { ProcurementOffer } from "./procurement";

const CACHE_MS = 15 * 60_000;
const cache = new Map<string, { at: number; offers: ProcurementOffer[] }>();

function cacheKey(article: string, brand?: string) {
  return `${article}|${brand || ""}`;
}

function normArticle(a: string) {
  return a.trim().toUpperCase().replace(/\s+/g, "");
}

/** Rossko API v2.1 GetSearch */
export async function fetchRosskoOffers(article: string, brand?: string): Promise<ProcurementOffer[]> {
  const key1 = process.env.ROSSKO_KEY1?.trim();
  const key2 = process.env.ROSSKO_KEY2?.trim();
  const deliveryId = process.env.ROSSKO_DELIVERY_ID?.trim() || "000000001";
  const addressId = process.env.ROSSKO_ADDRESS_ID?.trim() || "000000001";
  if (!key1 || !key2) return [];

  const art = normArticle(article);
  const ck = `rossko|${cacheKey(art, brand)}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.offers;

  const body = new URLSearchParams({
    KEY1: key1,
    KEY2: key2,
    delivery_id: deliveryId,
    address_id: addressId,
    text: brand ? `${brand} ${art}` : art,
  });

  try {
    const res = await fetch("http://api.rossko.ru/service/v2.1/GetSearch", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(12_000),
    });
    const xml = await res.text();
    const offers: ProcurementOffer[] = [];
    const parts = xml.split("<Part>");
    for (const chunk of parts.slice(1, 8)) {
      const brandM = chunk.match(/<brand>([^<]*)<\/brand>/i);
      const nameM = chunk.match(/<name>([^<]*)<\/name>/i);
      const artM = chunk.match(/<partnumber>([^<]*)<\/partnumber>/i) || chunk.match(/<vendorCode>([^<]*)<\/vendorCode>/i);
      const priceM = chunk.match(/<price>([^<]*)<\/price>/i);
      const stockM = chunk.match(/<count>([^<]*)<\/count>/i);
      const deliveryM = chunk.match(/<delivery>([^<]*)<\/delivery>/i);
      if (!artM && !nameM) continue;
      const price = priceM ? parseFloat(priceM[1]) : null;
      const qty = stockM ? parseInt(stockM[1], 10) : null;
      offers.push({
        supplier: "Rossko",
        supplierSlug: "rossko",
        name: nameM?.[1] || art,
        article: artM?.[1] || art,
        brand: brandM?.[1] || brand || null,
        price: Number.isFinite(price) ? price : null,
        qty: Number.isFinite(qty!) ? qty : null,
        deliveryDays: deliveryM ? parseInt(deliveryM[1], 10) || null : null,
        inStock: (qty || 0) > 0,
        source: "portal",
      });
    }
    cache.set(ck, { at: Date.now(), offers });
    return offers;
  } catch {
    return [];
  }
}

/** Emex B2B — EMEX_API_URL + EMEX_LOGIN + EMEX_PASSWORD (формат ответа зависит от дилерского API). */
export async function fetchEmexOffers(article: string, brand?: string): Promise<ProcurementOffer[]> {
  const login = process.env.EMEX_LOGIN?.trim();
  const password = process.env.EMEX_PASSWORD?.trim();
  if (!login || !password) return [];

  const art = normArticle(article);
  const ck = `emex|${cacheKey(art, brand)}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.offers;

  const apiUrl = (process.env.EMEX_API_URL?.trim() || "https://ws.emex.ru/EmExService.asmx/GetPrice").replace(/\/$/, "");

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        login,
        password,
        detailNum: art,
        make: brand || "",
        showSubsts: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.warn(`[emex] HTTP ${res.status} for ${art}`);
      return [];
    }
    const data = await res.json().catch(() => null) as Record<string, unknown> | null;
    if (!data) return [];

    const rows: Array<Record<string, unknown>> = Array.isArray(data)
      ? data as Array<Record<string, unknown>>
      : (data.data as { details?: unknown[] })?.details as Array<Record<string, unknown>>
        || (data.details as Array<Record<string, unknown>>)
        || (data.items as Array<Record<string, unknown>>)
        || [];

    const offers: ProcurementOffer[] = rows.slice(0, 12).map((r) => {
      const price = Number(r.price ?? r.Price ?? r.cost ?? 0);
      const qty = Number(r.quantity ?? r.Quantity ?? r.qty ?? 0);
      return {
        supplier: "Emex",
        supplierSlug: "emex",
        name: String(r.detailName ?? r.name ?? r.Name ?? art),
        article: String(r.detailNum ?? r.article ?? art),
        brand: String(r.make ?? r.brand ?? r.Make ?? brand ?? "") || null,
        price: Number.isFinite(price) && price > 0 ? price : null,
        qty: Number.isFinite(qty) ? qty : null,
        deliveryDays: Number(r.deliveryDays ?? r.DeliveryDays ?? 0) || null,
        inStock: qty > 0,
        source: "api" as const,
      };
    }).filter((o) => o.price != null);

    cache.set(ck, { at: Date.now(), offers });
    return offers;
  } catch (e) {
    console.warn("[emex]", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function fetchLiveSupplierOffers(article: string, brand?: string): Promise<ProcurementOffer[]> {
  const [rossko, emex] = await Promise.all([
    fetchRosskoOffers(article, brand),
    fetchEmexOffers(article, brand),
  ]);
  return [...rossko, ...emex];
}
