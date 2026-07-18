export type SalesDocType = "receipt" | "invoice";
export type SalesDocStatus = "draft" | "posted" | "cancelled";

export type SalesDocument = {
  id: number;
  docType: SalesDocType;
  docNumber: string;
  status: SalesDocStatus;
  clientId?: number | null;
  dealId?: number | null;
  managerId?: number | null;
  companyName?: string | null;
  recipientName?: string | null;
  recipientPhone?: string | null;
  notes?: string | null;
  warrantyText?: string | null;
  paymentMethod?: string | null;
  paymentAmount?: number | null;
  rounding?: number | null;
  totalAmount?: number | null;
  ofdReceiptId?: string | null;
  ofdStatus?: string | null;
  onecExportId?: string | null;
  postedAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  clientName?: string | null;
};

export type SalesDocumentItem = {
  id?: number;
  documentId?: number;
  stockPartId?: number | null;
  article?: string | null;
  brand?: string | null;
  name: string;
  qty?: number | null;
  price?: number | null;
  sortOrder?: number | null;
};

export function salesDocTypeLabel(docType: SalesDocType): string {
  return docType === "receipt" ? "Товарный чек" : "Расходная накладная";
}

export function salesDocStatusLabel(status: SalesDocStatus | string): string {
  return ({ draft: "Черновик", posted: "Проведён", cancelled: "Отменён" } as Record<string, string>)[status] || status;
}

export function salesDocStatusClass(status: SalesDocStatus | string): string {
  if (status === "posted") return "sales-doc-status sales-doc-status--posted";
  if (status === "cancelled") return "sales-doc-status sales-doc-status--cancelled";
  return "sales-doc-status sales-doc-status--draft";
}

export function paymentMethodLabel(method?: string | null): string {
  if (!method) return "—";
  return ({ cash: "Наличные", card: "Карта", transfer: "Перевод" } as Record<string, string>)[method] || method;
}

export function lineTotal(qty?: number | null, price?: number | null): number {
  return (qty || 1) * (price || 0);
}

export function formatMoney(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "—";
  return `${value.toLocaleString("ru-RU", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ₽`;
}

export function formatDocDate(value?: string | Date | null): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function postedToastText(data?: {
  ofd?: { ok?: boolean; externalId?: string; error?: string; status?: string };
  onec?: { ok?: boolean; externalId?: string; error?: string; status?: string };
}): { text: string; type: "success" | "error" } {
  const parts = ["Документ проведён"];
  const ofd = data?.ofd;
  const onec = data?.onec;
  if (ofd) {
    if (ofd.status === "disabled") parts.push("ОФД: пропущено");
    else if (ofd.ok) parts.push(ofd.externalId ? `ОФД: OK (#${ofd.externalId})` : "ОФД: OK");
    else parts.push(ofd.error ? `ОФД: ${ofd.error}` : "ОФД: ошибка");
  }
  if (onec) {
    if (onec.status === "disabled") parts.push("1С: пропущено");
    else if (onec.ok) parts.push(onec.externalId ? `1С: OK (#${onec.externalId})` : "1С: OK");
    else parts.push(onec.error ? `1С: ${onec.error}` : "1С: ошибка");
  }
  const hasError = !!(ofd && !ofd.ok && ofd.status !== "disabled")
    || !!(onec && !onec.ok && onec.status !== "disabled");
  return { text: parts.join(" · "), type: hasError ? "error" : "success" };
}
