import { normalizePlate } from "./plate-normalize";

export type StsParseResult = {
  plate: string | null;
  vin: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  color: string | null;
  ownerName: string | null;
  confidence: "high" | "medium" | "low";
};

const PLATE_RE = /[ABEKMHOPCTYXАВЕКМНОРСТУХ]\s*\d{3}\s*[ABEKMHOPCTYXАВЕКМНОРСТУХ]{2}\s*\d{2,3}/gi;
const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/gi;

function cleanLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function extractPlate(text: string): string | null {
  const matches = text.match(PLATE_RE);
  if (!matches?.length) return null;
  const sorted = [...matches].sort((a, b) => normalizePlate(b).length - normalizePlate(a).length);
  const norm = normalizePlate(sorted[0]);
  return norm.length >= 6 ? norm : null;
}

function extractVin(text: string): string | null {
  const m = text.match(VIN_RE);
  if (!m?.length) return null;
  const vin = m.find((v) => !/[IOQ]/i.test(v)) || m[0];
  return vin.toUpperCase();
}

function extractYear(text: string): number | null {
  const labeled = text.match(/(?:год\s*выпуска|выпуск)[^\d]{0,20}(\d{4})/i);
  if (labeled) {
    const y = parseInt(labeled[1], 10);
    if (y >= 1980 && y <= new Date().getFullYear() + 1) return y;
  }
  const years = [...text.matchAll(/\b(19[89]\d|20[0-3]\d)\b/g)].map((m) => parseInt(m[1], 10));
  if (years.length) return years.sort((a, b) => b - a)[0];
  return null;
}

function extractAfterLabel(text: string, labels: string[]): string | null {
  const lower = text.toLowerCase();
  for (const label of labels) {
    const idx = lower.indexOf(label);
    if (idx < 0) continue;
    const chunk = text.slice(idx + label.length, idx + label.length + 80);
    const line = cleanLine(chunk.replace(/^[\s:.\-—]+/, "").split("\n")[0]);
    if (line.length >= 2 && line.length <= 60) return line;
  }
  return null;
}

function extractMakeModel(text: string): { make: string | null; model: string | null } {
  const make = extractAfterLabel(text, ["марка", "марка, модель", "марка / модель"]);
  const model = extractAfterLabel(text, ["модель", "модель тс", "коммерческое наименование"]);
  if (make && !model) {
    const parts = make.split(/[,/]/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return { make: parts[0], model: parts.slice(1).join(" ") };
  }
  return { make: make || null, model: model || null };
}

function extractOwner(text: string): string | null {
  return extractAfterLabel(text, [
    "собственник", "владелец", "фамилия, имя", "фамилия имя", "фио",
  ]);
}

export function parseStsText(raw: string): StsParseResult {
  const text = raw.replace(/\r/g, "\n");
  const plate = extractPlate(text);
  const vin = extractVin(text);
  const year = extractYear(text);
  const { make, model } = extractMakeModel(text);
  const color = extractAfterLabel(text, ["цвет", "цвет кузова"]);
  const ownerName = extractOwner(text);

  let confidence: StsParseResult["confidence"] = "low";
  const score = [plate, vin, make || model, year].filter(Boolean).length;
  if (score >= 3 && plate && vin) confidence = "high";
  else if (score >= 2) confidence = "medium";

  return { plate, vin, make, model, year, color, ownerName, confidence };
}
