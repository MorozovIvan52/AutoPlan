export const DOC_TYPES = ["invoice", "upd", "act", "order"] as const;
export type DocType = (typeof DOC_TYPES)[number];

export function isDocType(v: unknown): v is DocType {
  return typeof v === "string" && (DOC_TYPES as readonly string[]).includes(v);
}

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  invoice: "Счёт на оплату",
  upd: "УПД",
  act: "Акт выполненных работ",
  order: "Заказ-наряд",
};

export const DOC_TYPE_PREFIX: Record<DocType, string> = {
  invoice: "INV",
  upd: "UPD",
  act: "ACT",
  order: "ZN",
};

export type DocParty = {
  name: string;
  address: string;
  phone: string;
  inn: string;
  kpp: string;
  bank: string;
  bik: string;
  rs: string;
  ks: string;
};

export type DocLine = {
  name: string;
  unit: string;
  qty: number;
  price: number;
  total: number;
  vat: number;
  kind: "labor" | "part";
};

export type DocTemplateData = {
  type: DocType;
  title: string;
  docNumber: string;
  date: string;
  tenant: DocParty;
  client: DocParty;
  vehicle: {
    makeModel: string;
    vin: string;
    plate: string;
    mileage: string;
  };
  dealId: number;
  warranty: string;
  items: DocLine[];
  subtotal: number;
  vatTotal: number;
  total: number;
  vatMode: "with_vat_20" | "without_vat";
  vatLabel: string;
  qrDataUrl: string | null;
  watermark: string;
};
