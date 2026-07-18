import {
  buildVinWarnings,
  decodeVinYear,
  decodeWmi,
  friendlyVinError,
  normalizeVinInput,
} from "./vin-local";

export type VinDecodeResult = {
  vin: string;
  make: string | null;
  model: string | null;
  year: number | null;
  engine: string | null;
  bodyClass: string | null;
  driveType: string | null;
  fuelType: string | null;
  plantCountry: string | null;
  warnings?: string[];
  raw?: Record<string, string | null>;
};

function pickValue(results: { Variable: string; Value: string | null }[], variable: string): string | null {
  const row = results.find((r) => r.Variable === variable);
  const v = row?.Value?.trim();
  if (!v || v === "Not Applicable" || v === "Not Provided") return null;
  return v;
}

function parseErrorCodes(errorCode: string | null): number[] {
  if (!errorCode) return [];
  return errorCode
    .split(",")
    .map((part) => parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function hasUsefulData(make: string | null, model: string | null, year: number | null): boolean {
  return Boolean(make || model || year);
}

function buildEngine(results: { Variable: string; Value: string | null }[]): string | null {
  const dispL = pickValue(results, "Displacement L");
  const dispCC = pickValue(results, "Displacement (CC)");
  const cyl = pickValue(results, "Engine Number of Cylinders");
  let engine: string | null = null;
  if (dispL) engine = `${dispL} л`;
  else if (dispCC) engine = `${dispCC} см³`;
  if (cyl && engine) engine = `${engine}, ${cyl} цил.`;
  return engine;
}

export async function decodeVin(vin: string): Promise<VinDecodeResult | { error: string }> {
  const { clean, invalidChars } = normalizeVinInput(vin);
  if (clean.length < 11) return { error: "VIN должен содержать минимум 11 символов" };
  if (clean.length > 17) return { error: "VIN не может быть длиннее 17 символов" };

  const localYear = decodeVinYear(clean);
  let warnings = buildVinWarnings([], invalidChars);

  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVin/${encodeURIComponent(clean)}?format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!res.ok) return { error: "Сервис декодирования VIN недоступен" };

    const data = await res.json() as { Results?: { Variable: string; Value: string | null }[] };
    const results = data.Results || [];

    const errorCodeRaw = pickValue(results, "Error Code");
    const errorText = pickValue(results, "Error Text");
    const errorCodes = parseErrorCodes(errorCodeRaw);
    warnings = [...warnings, ...buildVinWarnings(errorCodes, [])];

    const yearRaw = pickValue(results, "Model Year");
    let make = pickValue(results, "Make");
    let model = pickValue(results, "Model");
    let year = yearRaw ? parseInt(yearRaw, 10) || null : null;

    if (!year && localYear) year = localYear;

    if (!hasUsefulData(make, model, year)) {
      const wmi = await decodeWmi(clean);
      if (!make) make = wmi.make || wmi.manufacturer;
      if (!year) year = localYear;
    }

    if (!hasUsefulData(make, model, year)) {
      return { error: friendlyVinError(errorCodes, errorText) };
    }

    const uniqueWarnings = [...new Set(warnings)];
    return {
      vin: clean,
      make,
      model,
      year,
      engine: buildEngine(results),
      bodyClass: pickValue(results, "Body Class"),
      driveType: pickValue(results, "Drive Type"),
      fuelType: pickValue(results, "Fuel Type - Primary"),
      plantCountry: pickValue(results, "Plant Country"),
      warnings: uniqueWarnings.length ? uniqueWarnings : undefined,
    };
  } catch {
    if (localYear || clean.length >= 3) {
      const wmi = await decodeWmi(clean);
      if (wmi.make || localYear) {
        return {
          vin: clean,
          make: wmi.make || wmi.manufacturer,
          model: null,
          year: localYear,
          engine: null,
          bodyClass: null,
          driveType: null,
          fuelType: null,
          plantCountry: null,
          warnings: [...warnings, "Полный ответ от базы VIN не получен — подставлены только марка и год"],
        };
      }
    }
    return { error: "Таймаут при запросе к базе VIN" };
  }
}
