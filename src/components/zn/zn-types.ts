export type TabId =
  | "info"
  | "labor"
  | "parts"
  | "inspection"
  | "additional";

export const ZN_STATUSES = [
  "new",
  "quoted",
  "in_progress",
  "waiting_parts",
  "ready",
  "done",
  "cancelled",
] as const;

export type DealPayload = {
  id: number;
  title?: string | null;
  status?: string | null;
  description?: string | null;
  woNote?: string | null;
  vin?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleYear?: number | null;
  vehiclePlate?: string | null;
  mileage?: number | null;
  campaign?: string | null;
  warrantyObligations?: string | null;
  contractTerms?: string | null;
  inspectionReport?: string | null;
  paidAmount?: number | null;
  amount?: number | null;
  clientIsPayer?: boolean | number | null;
  appointmentId?: number | null;
  updatedAt?: string | number | Date | null;
  createdAt?: string | number | Date | null;
};

export type ClientPayload = {
  id?: number;
  name?: string | null;
  phone?: string | null;
};

export type LaborRow = {
  id: number;
  name?: string | null;
  code?: string | null;
  normHours?: number | null;
  hours?: number | null;
  price?: number | null;
  executorName?: string | null;
};

export type PartRow = {
  id: number;
  name?: string | null;
  article?: string | null;
  brand?: string | null;
  qty?: number | null;
  price?: number | null;
  stockPartId?: number | null;
  partSource?: string | null;
};

export type InspectionReportData = {
  version: 1;
  fuelLevel: "E" | "1/4" | "1/2" | "3/4" | "F";
  paintDefects: string;
  notes: string;
  completeness: string[];
  mileage: number | null;
  strokes: Record<string, StrokePoint[][]>;
  stamps: StampMark[];
};

export type StrokePoint = { x: number; y: number };
export type StampMark = {
  view: string;
  x: number;
  y: number;
  kind: "B" | "C" | "T" | "Ц";
};

export function money(n: number | null | undefined) {
  return `${Math.round(Number(n) || 0).toLocaleString("ru-RU")} ₽`;
}

export function emptyInspection(mileage: number | null = null): InspectionReportData {
  return {
    version: 1,
    fuelLevel: "1/2",
    paintDefects: "",
    notes: "",
    completeness: [],
    mileage,
    strokes: { left: [], right: [], front: [], rear: [], top: [] },
    stamps: [],
  };
}

export function parseInspection(raw: string | null | undefined, mileage: number | null): InspectionReportData {
  if (!raw?.trim()) return emptyInspection(mileage);
  try {
    const parsed = JSON.parse(raw) as Partial<InspectionReportData>;
    const base = emptyInspection(mileage);
    return {
      ...base,
      ...parsed,
      version: 1,
      strokes: { ...base.strokes, ...(parsed.strokes || {}) },
      stamps: Array.isArray(parsed.stamps) ? parsed.stamps : [],
      completeness: Array.isArray(parsed.completeness) ? parsed.completeness : [],
      mileage: parsed.mileage ?? mileage,
    };
  } catch {
    return {
      ...emptyInspection(mileage),
      notes: raw,
    };
  }
}
