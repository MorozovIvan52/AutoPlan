/**
 * 1С / ОФД / онлайн-касса — HTTP-адаптеры (Atol Online, CloudKassir, произвольный webhook 1С).
 */
import { getCrmSettings } from "../lib/crm-settings";

export type FiscalReceiptPayload = {
  docId: number;
  docNumber: string;
  docType: "receipt" | "invoice";
  total: number;
  paymentMethod: string;
  items: { name: string; qty: number; price: number; sum: number }[];
  clientName?: string | null;
  clientPhone?: string | null;
  companyInn?: string | null;
};

export type IntegrationResult = {
  ok: boolean;
  status: string;
  externalId?: string;
  error?: string;
  raw?: unknown;
};

function settingsFromRow(s: Awaited<ReturnType<typeof getCrmSettings>>) {
  const row = s as Record<string, unknown>;
  return {
    onecEnabled: Boolean(row.onecEnabled),
    onecUrl: String(row.onecUrl || process.env.ONEC_HTTP_URL || "").trim(),
    onecToken: String(row.onecToken || process.env.ONEC_HTTP_TOKEN || "").trim(),
    ofdEnabled: Boolean(row.ofdEnabled),
    ofdProvider: String(row.ofdProvider || process.env.OFD_PROVIDER || "atol").trim(),
    ofdToken: String(row.ofdToken || process.env.OFD_TOKEN || "").trim(),
    ofdGroupCode: String(row.ofdGroupCode || process.env.OFD_GROUP_CODE || "").trim(),
    companyInn: s.companyInn || process.env.COMPANY_INN || null,
  };
}

/** Выгрузка документа в 1С (HTTP-сервис или webhook) */
export async function pushDocumentTo1C(document: FiscalReceiptPayload): Promise<IntegrationResult> {
  const settings = settingsFromRow(await getCrmSettings());
  if (!settings.onecEnabled && !settings.onecUrl) {
    return { ok: false, status: "disabled", error: "1С не настроена" };
  }
  if (!settings.onecUrl) {
    return { ok: false, status: "error", error: "ONEC_URL не задан" };
  }

  const body = {
    type: "sales_document",
    id: document.docId,
    number: document.docNumber,
    docType: document.docType,
    total: document.total,
    paymentMethod: document.paymentMethod,
    items: document.items,
    client: { name: document.clientName, phone: document.clientPhone },
    exportedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(settings.onecUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(settings.onecToken ? { Authorization: `Bearer ${settings.onecToken}` } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* */ }
    if (!res.ok) {
      return { ok: false, status: "error", error: `1С HTTP ${res.status}`, raw: parsed };
    }
    const extId = typeof parsed === "object" && parsed && "id" in parsed
      ? String((parsed as { id: unknown }).id)
      : `1c-${document.docId}-${Date.now()}`;
    return { ok: true, status: "exported", externalId: extId, raw: parsed };
  } catch (e: unknown) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

/** Фискальный чек через Atol Online / CloudKassir / generic webhook */
export async function registerCashReceipt(receipt: FiscalReceiptPayload): Promise<IntegrationResult> {
  const settings = settingsFromRow(await getCrmSettings());
  if (!settings.ofdEnabled && !settings.ofdToken) {
    return { ok: false, status: "disabled", error: "ОФД не настроена" };
  }

  const provider = settings.ofdProvider.toLowerCase();
  const webhookUrl = process.env.OFD_WEBHOOK_URL?.trim();

  if (provider === "atol" && settings.ofdGroupCode && settings.ofdToken) {
    return registerAtolOnline(receipt, settings);
  }
  if (webhookUrl) {
    return registerGenericOfd(webhookUrl, receipt, settings.ofdToken);
  }
  if (settings.ofdToken && provider === "cloudkassir") {
    return registerCloudKassir(receipt, settings);
  }
  return { ok: false, status: "error", error: "Укажите OFD_TOKEN + OFD_GROUP_CODE (Atol) или OFD_WEBHOOK_URL" };
}

async function registerAtolOnline(
  receipt: FiscalReceiptPayload,
  settings: { ofdToken: string; ofdGroupCode: string; companyInn: string | null },
): Promise<IntegrationResult> {
  const base = process.env.ATOL_API_URL || "https://online.atol.ru/possystem/v5";
  const payload = {
    external_id: `crm-${receipt.docId}-${Date.now()}`,
    receipt: {
      client: { email: null, phone: receipt.clientPhone || null },
      company: { email: process.env.MAIL_FROM || "", inn: settings.companyInn || "", payment_address: process.env.PUBLIC_URL || "" },
      items: receipt.items.map((i) => ({
        name: i.name.slice(0, 128),
        price: i.price,
        quantity: i.qty,
        sum: i.sum,
        payment_method: "full_payment",
        payment_object: "commodity",
        vat: { type: "none" },
      })),
      payments: [{ type: receipt.paymentMethod === "card" ? 1 : 0, sum: receipt.total }],
      total: receipt.total,
    },
    timestamp: new Date().toISOString().replace("T", " ").slice(0, 19),
  };

  try {
    const res = await fetch(`${base}/${settings.ofdGroupCode}/sell?token=${encodeURIComponent(settings.ofdToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({})) as { uuid?: string; error?: { text?: string } };
    if (!res.ok || data.error) {
      return { ok: false, status: "error", error: data.error?.text || `Atol HTTP ${res.status}`, raw: data };
    }
    return { ok: true, status: "queued", externalId: data.uuid, raw: data };
  } catch (e: unknown) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function registerCloudKassir(
  receipt: FiscalReceiptPayload,
  settings: { ofdToken: string },
): Promise<IntegrationResult> {
  const publicId = process.env.CLOUDKASSIR_PUBLIC_ID?.trim();
  if (!publicId) return { ok: false, status: "error", error: "CLOUDKASSIR_PUBLIC_ID не задан" };

  const auth = Buffer.from(`${publicId}:${settings.ofdToken}`).toString("base64");
  const payload = {
    Type: "Income",
    InvoiceId: `crm-${receipt.docId}`,
    AccountId: receipt.clientPhone || "guest",
    Amount: receipt.total,
    Label: `Чек ${receipt.docNumber}`,
    JsonData: { items: receipt.items },
  };

  try {
    const res = await fetch("https://api.cloudpayments.ru/kkt/receipt", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const data = await res.json().catch(() => ({})) as { Model?: { Id?: string }; Message?: string };
    if (!res.ok) return { ok: false, status: "error", error: data.Message || `CloudKassir ${res.status}`, raw: data };
    return { ok: true, status: "queued", externalId: data.Model?.Id, raw: data };
  } catch (e: unknown) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

async function registerGenericOfd(
  url: string,
  receipt: FiscalReceiptPayload,
  token: string,
): Promise<IntegrationResult> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(receipt),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: "error", error: `OFD HTTP ${res.status}`, raw: data };
    const extId = typeof data === "object" && data && "receiptId" in data
      ? String((data as { receiptId: unknown }).receiptId)
      : undefined;
    return { ok: true, status: "ok", externalId: extId, raw: data };
  } catch (e: unknown) {
    return { ok: false, status: "error", error: e instanceof Error ? e.message : String(e) };
  }
}

export async function getIntegrationStatus() {
  const s = settingsFromRow(await getCrmSettings());
  return {
    onec: { enabled: s.onecEnabled, configured: Boolean(s.onecUrl) },
    ofd: { enabled: s.ofdEnabled, provider: s.ofdProvider, configured: Boolean(s.ofdToken || process.env.OFD_WEBHOOK_URL) },
    sms: Boolean(process.env.SMS_API_ID),
    rossko: Boolean(process.env.ROSSKO_KEY1 && process.env.ROSSKO_KEY2),
  };
}
