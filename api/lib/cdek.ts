import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { getTenantId } from "./tenant-context";

type CdekSettings = typeof schema.cdekSettings.$inferSelect;

let tokenCache: { token: string; expiresAt: number } | null = null;

function apiBase(testMode: boolean) {
  return testMode ? "https://api.edu.cdek.ru/v2" : "https://api.cdek.ru/v2";
}

export async function getCdekSettings(): Promise<CdekSettings> {
  const tenantId = getTenantId();
  const [row] = await db.select().from(schema.cdekSettings)
    .where(eq(schema.cdekSettings.tenantId, tenantId))
    .limit(1);
  if (row) return row;
  const [created] = await db.insert(schema.cdekSettings).values({
    tenantId,
    testMode: true,
    defaultTariffCode: 136,
  }).returning();
  return created;
}

function resolveCredentials(settings: CdekSettings) {
  const clientId = settings.clientId || process.env.CDEK_CLIENT_ID || "";
  const clientSecret = settings.clientSecret || process.env.CDEK_CLIENT_SECRET || "";
  return { clientId, clientSecret };
}

export function isCdekEnabled(settings: CdekSettings): boolean {
  if (process.env.CDEK_ENABLED === "true") return true;
  if (process.env.CDEK_ENABLED === "false") return false;
  return !!settings.enabled;
}

export function isCdekTestMode(settings: CdekSettings): boolean {
  if (process.env.CDEK_TEST_MODE === "true") return true;
  if (process.env.CDEK_TEST_MODE === "false") return false;
  return settings.testMode !== false;
}

export function resolveShipmentPoint(settings: CdekSettings): string | null {
  return settings.shipmentPoint || process.env.CDEK_SHIPMENT_POINT || null;
}

export function resolveFromCityCode(settings: CdekSettings): number | null {
  if (settings.fromCityCode) return settings.fromCityCode;
  const env = process.env.CDEK_FROM_CITY_CODE;
  return env ? Number(env) || null : null;
}

export function isCdekConfigured(settings: CdekSettings): boolean {
  const { clientId, clientSecret } = resolveCredentials(settings);
  return Boolean(clientId && clientSecret && isCdekEnabled(settings));
}

async function getToken(settings: CdekSettings): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) return tokenCache.token;

  const { clientId, clientSecret } = resolveCredentials(settings);
  if (!clientId || !clientSecret) throw new Error("СДЭК: укажите Account и Secure password в настройках");

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch(`${apiBase(isCdekTestMode(settings))}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const data = await res.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(data.error || `СДЭК авторизация: ${res.status}`);
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: now + (data.expires_in || 3600) * 1000,
  };
  return data.access_token;
}

async function cdekFetch<T>(settings: CdekSettings, path: string, opts: RequestInit = {}): Promise<T> {
  const token = await getToken(settings);
  const res = await fetch(`${apiBase(isCdekTestMode(settings))}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });

  const text = await res.text();
  let data: T & { errors?: { message: string }[] };
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`СДЭК: неверный ответ (${res.status})`);
  }

  if (!res.ok) {
    const msg = (data as any)?.errors?.[0]?.message || text.slice(0, 200) || res.statusText;
    throw new Error(`СДЭК: ${msg}`);
  }
  return data;
}

export async function searchCities(settings: CdekSettings, query: string) {
  const q = encodeURIComponent(query.trim());
  const data = await cdekFetch<{ city?: string; code?: number; region?: string }[]>(
    settings,
    `/location/cities?country_codes=RU&city=${q}&size=15`,
  );
  return Array.isArray(data) ? data : [];
}

type CdekDeliveryPoint = { code?: string; location?: { address?: string }; name?: string };

export async function listPvz(settings: CdekSettings, cityCode: number, query?: string) {
  const pageSize = 500;
  const all: { code: string; name: string; address: string }[] = [];

  for (let page = 0; page < 20; page++) {
    const data = await cdekFetch<CdekDeliveryPoint[]>(
      settings,
      `/deliverypoints?city_code=${cityCode}&type=PVZ&country_codes=RU&size=${pageSize}&page=${page}`,
    );
    const batch = (Array.isArray(data) ? data : []).map((p) => ({
      code: p.code || "",
      name: p.name || "",
      address: p.location?.address || p.name || "",
    }));
    all.push(...batch);
    if (batch.length < pageSize) break;
  }

  const q = query?.trim().toLowerCase();
  const filtered = q
    ? all.filter((p) =>
        p.address.toLowerCase().includes(q)
        || p.name.toLowerCase().includes(q)
        || p.code.toLowerCase().includes(q),
      )
    : all;

  return filtered.sort((a, b) => a.address.localeCompare(b.address, "ru"));
}

export async function calculateTariffs(settings: CdekSettings, opts: {
  fromCityCode: number;
  toCityCode: number;
  weight: number;
  length?: number;
  width?: number;
  height?: number;
}) {
  const pkg = {
    weight: Math.max(opts.weight, 100),
    length: opts.length || 20,
    width: opts.width || 15,
    height: opts.height || 10,
  };
  const data = await cdekFetch<{ tariff_codes?: { tariff_code: number; tariff_name: string; delivery_sum: number; period_min: number; period_max: number }[] }>(
    settings,
    "/calculator/tarifflist",
    {
      method: "POST",
      body: JSON.stringify({
        type: 1,
        from_location: { code: opts.fromCityCode },
        to_location: { code: opts.toCityCode },
        packages: [pkg],
      }),
    },
  );
  return data.tariff_codes || [];
}

/** Точная стоимость выбранного тарифа СДЭК (вес, габариты, города). */
export async function calculateTariffPrice(settings: CdekSettings, opts: {
  fromCityCode: number;
  toCityCode: number;
  tariffCode: number;
  weight: number;
  length?: number;
  width?: number;
  height?: number;
}): Promise<number> {
  const pkg = {
    weight: Math.max(opts.weight, 100),
    length: Math.max(opts.length || 20, 1),
    width: Math.max(opts.width || 15, 1),
    height: Math.max(opts.height || 10, 1),
  };
  const data = await cdekFetch<{ delivery_sum?: number; total_sum?: number }>(
    settings,
    "/calculator/tariff",
    {
      method: "POST",
      body: JSON.stringify({
        type: 1,
        tariff_code: opts.tariffCode,
        from_location: { code: opts.fromCityCode },
        to_location: { code: opts.toCityCode },
        packages: [pkg],
      }),
    },
  );
  const sum = data.delivery_sum ?? data.total_sum ?? 0;
  return Math.round(sum);
}

export type CdekPackageItem = {
  name: string;
  wareKey: string;
  cost: number;
  weight: number;
  qty: number;
  paymentValue: number;
};

export type CreateCdekOrderInput = {
  imNumber: string;
  tariffCode: number;
  shipmentPoint?: string | null;
  deliveryPoint: string;
  recipientName: string;
  recipientPhone: string;
  goodsPaymentFromRecipient: boolean;
  deliveryFromRecipient: boolean;
  deliveryRecipientCost: number;
  packages: {
    weight: number;
    length: number;
    width: number;
    height: number;
    items: CdekPackageItem[];
  }[];
};

export function normalizeCdekPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith("7")) return digits;
  return digits.startsWith("7") ? digits : `7${digits.slice(-10)}`;
}

export async function deleteCdekOrder(settings: CdekSettings, uuid: string) {
  await cdekFetch(settings, `/orders/${uuid}`, { method: "DELETE" });
}

export function isCdekImNumberConflict(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("is order no")
    || m.includes("not unique")
    || m.includes("already exists")
    || m.includes("уже существует")
    || m.includes("не уникал")
  );
}

/** Русское сообщение, если № ИМ (название заказа) уже занят в СДЭК */
export function localizeCdekImNumberConflict(imNumber: string): string {
  const n = imNumber.trim();
  if (n) {
    return `Заказ с номером «${n}» уже есть в СДЭК. Измените название заказа в CRM или нажмите «Пересоздать накладную», чтобы заменить старую заявку.`;
  }
  return "Заказ с таким номером уже есть в СДЭК. Измените название заказа в CRM или пересоздайте накладную.";
}

export function localizeCdekError(message: string, imNumber?: string): string {
  const raw = message.replace(/^СДЭК:\s*/i, "").trim();
  if (isCdekImNumberConflict(raw)) {
    return localizeCdekImNumberConflict(imNumber || "");
  }
  if (message.startsWith("СДЭК")) return message;
  return `СДЭК: ${message}`;
}

/** Снимает старую заявку в СДЭК, чтобы пересоздать с тем же № ИМ из CRM */
export async function releaseCdekOrderForRecreate(
  settings: CdekSettings,
  deal: { cdekOrderUuid?: string | null; title: string },
) {
  const imNumber = deal.title.trim();
  const uuids = new Set<string>();
  if (deal.cdekOrderUuid) uuids.add(deal.cdekOrderUuid);
  if (imNumber) {
    const existing = await getCdekOrderByNumber(settings, imNumber).catch(() => null);
    if (existing?.uuid) uuids.add(existing.uuid);
  }
  for (const uuid of uuids) {
    await deleteCdekOrder(settings, uuid).catch(() => null);
    await new Promise((r) => setTimeout(r, 500));
  }
}

export async function createCdekOrder(settings: CdekSettings, input: CreateCdekOrderInput) {
  const shipmentPoint = input.shipmentPoint || resolveShipmentPoint(settings);
  if (!shipmentPoint) throw new Error("Укажите код ПВЗ отправки в настройках СДЭК");

  const imNumber = input.imNumber.trim();
  if (!imNumber) throw new Error("Укажите № отправления ИМ (название заказа)");

  const phone = normalizeCdekPhone(input.recipientPhone);
  if (phone.length !== 11 || !phone.startsWith("7")) {
    throw new Error("Некорректный телефон получателя — нужен номер РФ в формате 7XXXXXXXXXX");
  }
  const body: Record<string, unknown> = {
    type: 1,
    number: imNumber,
    tariff_code: input.tariffCode,
    shipment_point: shipmentPoint,
    delivery_point: input.deliveryPoint,
    recipient: {
      name: input.recipientName,
      phones: [{ number: phone }],
    },
    packages: input.packages.map((pkg, i) => ({
      number: String(i + 1),
      weight: Math.max(Math.round(pkg.weight), 100),
      length: Math.max(Math.round(pkg.length), 1),
      width: Math.max(Math.round(pkg.width), 1),
      height: Math.max(Math.round(pkg.height), 1),
      items: pkg.items.map((item) => ({
        name: item.name.slice(0, 255),
        ware_key: item.wareKey.slice(0, 50),
        payment: {
          value: input.goodsPaymentFromRecipient ? Math.max(0, Math.round(item.paymentValue)) : 0,
        },
        cost: Math.max(0, Math.round(item.cost)),
        weight: Math.max(Math.round(item.weight), 100),
        amount: Math.max(1, item.qty),
      })),
    })),
  };

  if (input.deliveryFromRecipient && input.deliveryRecipientCost > 0) {
    body.delivery_recipient_cost = {
      value: Math.round(input.deliveryRecipientCost),
      vat_sum: 0,
      vat_rate: 0,
    };
  }

  const data = await cdekFetch<{ entity?: { uuid?: string }; requests?: { request_uuid?: string }[] }>(
    settings,
    "/orders",
    { method: "POST", body: JSON.stringify(body) },
  );

  return {
    uuid: data.entity?.uuid || null,
    requestUuid: data.requests?.[0]?.request_uuid || null,
  };
}

export async function getCdekOrderByNumber(settings: CdekSettings, imNumber: string) {
  const data = await cdekFetch<{ entity?: {
    uuid?: string;
    cdek_number?: string;
    statuses?: { code?: string; name?: string; date_time?: string }[];
  } }>(
    settings,
    `/orders?im_number=${encodeURIComponent(imNumber)}`,
  );
  return data.entity || null;
}

export async function getCdekOrderFull(settings: CdekSettings, uuid: string) {
  return cdekFetch<{
    entity?: {
      uuid?: string;
      cdek_number?: string;
      statuses?: { code?: string; name?: string; date_time?: string }[];
    };
    requests?: {
      state?: string;
      errors?: { code?: string; message?: string }[];
      warnings?: { code?: string; message?: string }[];
    }[];
  }>(settings, `/orders/${uuid}`);
}

export function extractCdekOrderErrors(data: {
  requests?: { state?: string; errors?: { code?: string; message?: string }[] }[];
} | null | undefined): string[] {
  if (!data?.requests?.length) return [];
  const messages: string[] = [];
  for (const req of data.requests) {
    if (req.state !== "INVALID") continue;
    for (const err of req.errors || []) {
      const msg = (err.message || err.code || "").trim();
      if (msg) messages.push(msg);
    }
  }
  return messages;
}

export async function getCdekOrderByUuid(settings: CdekSettings, uuid: string) {
  const data = await getCdekOrderFull(settings, uuid);
  return data.entity || null;
}

export function defaultPackageFromDeal(deal: typeof schema.deals.$inferSelect, items: typeof schema.orderItems.$inferSelect[]) {
  const totalWeight = items.length
    ? items.reduce((s, i) => s + (i.qty || 1) * 500, 0)
    : 1000;

  const orderItems = items.length
    ? items.map((i) => ({
      name: i.name,
      wareKey: i.article || `item-${i.id}`,
      cost: i.price || deal.amount || 0,
      weight: 500,
      qty: i.qty || 1,
    }))
    : [{
      name: deal.title,
      wareKey: `deal-${deal.id}`,
      cost: deal.amount || 0,
      weight: 1000,
      qty: 1,
    }];

  return {
    weight: Math.max(totalWeight, 500),
    length: 25,
    width: 20,
    height: 15,
    items: orderItems,
  };
}
