/**
 * Сбор данных ЗН/сделки для HTML-шаблонов официальных документов.
 */
import { and, eq, like, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { db } from "../database";
import * as schema from "../database/schema";
import { getCrmSettings } from "./crm-settings";
import { forTenant, withTenant } from "./tenant-query";
import {
  DOC_TYPE_LABELS,
  DOC_TYPE_PREFIX,
  type DocLine,
  type DocParty,
  type DocTemplateData,
  type DocType,
} from "./doc-types";

function dash(v: string | null | undefined): string {
  const t = (v || "").trim();
  return t || "—";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function formatRuDate(d: Date): string {
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function splitVat(total: number, withVat: boolean): { subtotal: number; vat: number } {
  if (!withVat || total <= 0) return { subtotal: round2(total), vat: 0 };
  const vat = round2(total * 20 / 120);
  return { subtotal: round2(total - vat), vat };
}

async function nextDocNumber(type: DocType): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `${DOC_TYPE_PREFIX[type]}-${year}-`;
  const rows = await db
    .select({ docNumber: schema.documents.docNumber })
    .from(schema.documents)
    .where(withTenant(schema.documents, and(
      eq(schema.documents.type, type),
      like(schema.documents.docNumber, `${prefix}%`),
    )));
  let max = 0;
  for (const r of rows) {
    const m = String(r.docNumber || "").match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]) || 0);
  }
  return `${prefix}${String(max + 1).padStart(5, "0")}`;
}

async function buildQrDataUrl(payload: string | null | undefined, total: number, docNumber: string): Promise<string | null> {
  const text = (payload || "").trim()
    || `Оплата счёта ${docNumber} на сумму ${total.toFixed(2)} RUB (СБП — укажите реквизиты в настройках CRM)`;
  try {
    return await QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: "M" });
  } catch {
    return null;
  }
}

export async function buildDocData(dealId: number, type: DocType): Promise<DocTemplateData> {
  const [deal] = await db
    .select()
    .from(schema.deals)
    .where(withTenant(schema.deals, eq(schema.deals.id, dealId)))
    .limit(1);
  if (!deal) {
    throw Object.assign(new Error("Заказ-наряд не найден"), { status: 404 });
  }

  const settings = await getCrmSettings();
  let client: typeof schema.clients.$inferSelect | null = null;
  if (deal.clientId) {
    const [c] = await db
      .select()
      .from(schema.clients)
      .where(withTenant(schema.clients, eq(schema.clients.id, deal.clientId)))
      .limit(1);
    client = c ?? null;
  }

  const labor = await db
    .select()
    .from(schema.dealLaborItems)
    .where(eq(schema.dealLaborItems.dealId, dealId));
  const parts = await db
    .select()
    .from(schema.orderItems)
    .where(eq(schema.orderItems.dealId, dealId));

  const withVat = (settings.vatMode || "with_vat_20") !== "without_vat";
  const items: DocLine[] = [];

  for (const l of labor) {
    const total = round2(Number(l.price) || 0);
    const { subtotal, vat } = splitVat(total, withVat);
    items.push({
      name: l.name || "Работа",
      unit: "усл.",
      qty: Number(l.hours ?? l.normHours ?? 1) || 1,
      price: round2(Number(l.hourlyRate) || (total / Math.max(1, Number(l.hours ?? l.normHours ?? 1)))),
      total: withVat ? total : subtotal,
      vat,
      kind: "labor",
    });
  }

  for (const p of parts) {
    if (p.embeddedInLabor) continue;
    const qty = Number(p.qty) || 1;
    const price = Number(p.price) || 0;
    const total = round2(qty * price);
    const { vat } = splitVat(total, withVat);
    const label = [p.brand, p.name || p.article].filter(Boolean).join(" · ") || "Запчасть";
    items.push({
      name: label,
      unit: "шт.",
      qty,
      price: round2(price),
      total,
      vat,
      kind: "part",
    });
  }

  const total = round2(
    Number(deal.amount)
    || items.reduce((s, i) => s + i.total, 0),
  );
  const vatTotal = round2(items.reduce((s, i) => s + i.vat, 0));
  const subtotal = round2(total - vatTotal);

  const docNumber = await nextDocNumber(type);
  const tenant: DocParty = {
    name: dash(settings.companyName),
    address: dash(settings.companyAddress),
    phone: dash(settings.companyPhone),
    inn: dash(settings.companyInn),
    kpp: dash(settings.companyKpp),
    bank: dash(settings.companyBank),
    bik: dash(settings.companyBik),
    rs: dash(settings.companyRs),
    ks: dash(settings.companyKs),
  };

  const clientParty: DocParty = {
    name: dash(client?.company || client?.name || deal.companyName),
    address: dash(client?.legalAddress),
    phone: dash(client?.phone),
    inn: dash(client?.clientInn),
    kpp: dash(client?.clientKpp),
    bank: "—",
    bik: "—",
    rs: "—",
    ks: "—",
  };

  const makeModel = [
    deal.vehicleMake,
    deal.vehicleModel,
    deal.vehicleYear,
  ].filter(Boolean).join(" ");

  const qrDataUrl = type === "invoice"
    ? await buildQrDataUrl(settings.sbpPayPayload, total, docNumber)
    : null;

  return {
    type,
    title: DOC_TYPE_LABELS[type],
    docNumber,
    date: formatRuDate(new Date()),
    tenant,
    client: clientParty,
    vehicle: {
      makeModel: makeModel || "—",
      vin: dash(deal.vin),
      plate: dash(deal.vehiclePlate),
      mileage: deal.mileage != null ? String(deal.mileage) : "—",
    },
    dealId,
    warranty: dash(deal.warrantyObligations) === "—"
      ? "По регламенту СТО и производителя."
      : String(deal.warrantyObligations),
    items,
    subtotal,
    vatTotal,
    total,
    vatMode: withVat ? "with_vat_20" : "without_vat",
    vatLabel: withVat ? "в том числе НДС 20%" : "без НДС",
    qrDataUrl,
    watermark: "КОПИЯ",
  };
}

/** Лёгкая проверка, что таблица доступна (для тестов/метрик). */
export async function countTenantDocuments(): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.documents)
    .where(forTenant(schema.documents));
  return Number(row?.c || 0);
}
