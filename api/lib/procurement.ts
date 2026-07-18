import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { fetchLiveSupplierOffers } from "./supplier-apis";
import { forTenant } from "./tenant-query";
export type ProcurementOffer = {
  supplier: string;
  supplierSlug: string;
  name: string;
  article: string;
  brand: string | null;
  price: number | null;
  qty: number | null;
  deliveryDays: number | null;
  inStock: boolean;
  source: "warehouse" | "history" | "portal" | "api";
  url?: string;
  stockPartId?: number;
};

const SUPPLIER_PORTALS: { slug: string; name: string; buildUrl: (article: string, brand?: string) => string }[] = [
  {
    slug: "exist",
    name: "Exist.ru",
    buildUrl: (a) => `https://www.exist.ru/Price/?pcode=${encodeURIComponent(a)}`,
  },
  {
    slug: "emex",
    name: "Emex",
    buildUrl: (a) => `https://emex.ru/search?q=${encodeURIComponent(a)}`,
  },
  {
    slug: "autodoc",
    name: "Autodoc",
    buildUrl: (a, b) => `https://www.autodoc.ru/search?query=${encodeURIComponent(b ? `${b} ${a}` : a)}`,
  },
  {
    slug: "zzap",
    name: "ZZap",
    buildUrl: (a) => `https://www.zzap.ru/public/search.aspx#rawdata=${encodeURIComponent(a)}`,
  },
  {
    slug: "autopiter",
    name: "Autopiter",
    buildUrl: (a) => `https://autopiter.ru/goods/${encodeURIComponent(a)}`,
  },
  {
    slug: "rossko",
    name: "Rossko",
    buildUrl: (a) => `https://rossko.ru/search/?q=${encodeURIComponent(a)}`,
  },
];

function normArticle(a: string) {
  return a.trim().toUpperCase().replace(/\s+/g, "");
}

export async function searchProcurement(article: string, brand?: string): Promise<{
  article: string;
  brand: string | null;
  offers: ProcurementOffer[];
  portals: { slug: string; name: string; url: string }[];
}> {
  const art = normArticle(article);
  const br = brand?.trim() || null;
  if (!art) return { article: "", brand: br, offers: [], portals: [] };

  const allStock = await db.select().from(schema.partsStock).where(forTenant(schema.partsStock));
  const warehouse = allStock.filter((p) => {
    const pa = normArticle(p.article);
    if (pa === art || pa.includes(art) || art.includes(pa)) return true;
    if (br && p.brand && p.brand.toLowerCase() === br.toLowerCase() && pa.includes(art.slice(0, 5))) return true;
    return false;
  });

  const dealJoined = await db.select({ item: schema.orderItems })
    .from(schema.orderItems)
    .innerJoin(schema.deals, eq(schema.orderItems.dealId, schema.deals.id))
    .where(forTenant(schema.deals));
  const allOrderItems = dealJoined.map((r) => r.item);
  const history = allOrderItems.filter((i) => {
    if (!i.article) return false;
    const ia = normArticle(i.article);
    return ia === art || ia.includes(art);
  });

  const offers: ProcurementOffer[] = [];

  for (const p of warehouse) {
    offers.push({
      supplier: "Наш склад",
      supplierSlug: "warehouse",
      name: p.name,
      article: p.article,
      brand: p.brand,
      price: p.price,
      qty: p.qty,
      deliveryDays: 0,
      inStock: (p.qty || 0) > 0,
      source: "warehouse",
      stockPartId: p.id,
    });
  }

  const seenHistory = new Set<string>();
  for (const h of history.slice(0, 20)) {
    const key = `${h.article}|${h.brand}|${h.price}`;
    if (seenHistory.has(key)) continue;
    seenHistory.add(key);
    if (warehouse.some((w) => normArticle(w.article) === normArticle(h.article || ""))) continue;
    offers.push({
      supplier: "История заказов",
      supplierSlug: "history",
      name: h.name,
      article: h.article || art,
      brand: h.brand,
      price: h.price,
      qty: h.qty,
      deliveryDays: null,
      inStock: h.inStock ?? false,
      source: "history",
    });
  }

  const portals = SUPPLIER_PORTALS.map((s) => ({
    slug: s.slug,
    name: s.name,
    url: s.buildUrl(art, br || undefined),
  }));

  for (const portal of SUPPLIER_PORTALS) {
    if (offers.some((o) => o.supplierSlug === portal.slug && o.price != null)) continue;
    const hasLive = offers.some((o) => o.supplierSlug === portal.slug);
    if (hasLive) continue;
    offers.push({
      supplier: portal.name,
      supplierSlug: portal.slug,
      name: br ? `${br} — арт. ${art}` : `Артикул ${art}`,
      article: art,
      brand: br,
      price: null,
      qty: null,
      deliveryDays: null,
      inStock: false,
      source: "portal",
      url: portal.buildUrl(art, br || undefined),
    });
  }

  const liveOffers = await fetchLiveSupplierOffers(art, br || undefined);
  for (const lo of liveOffers) {
    const idx = offers.findIndex((o) => o.supplierSlug === lo.supplierSlug);
    if (idx >= 0) offers[idx] = { ...offers[idx], ...lo, url: offers[idx].url };
    else offers.push(lo);
  }

  offers.sort((a, b) => {
    const rank = (o: ProcurementOffer) => {
      if (o.source === "warehouse" && o.inStock) return 0;
      if (o.source === "warehouse") return 1;
      if (o.source === "history" && o.price != null) return 2;
      if (o.source === "portal") return 4;
      return 3;
    };
    const dr = rank(a) - rank(b);
    if (dr !== 0) return dr;
    return (a.price ?? 999999) - (b.price ?? 999999);
  });

  return { article: art, brand: br, offers, portals };
}
