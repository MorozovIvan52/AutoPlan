/** Год выпуска из 10-й позиции VIN (ISO 3779) */
const YEAR_CYCLES: Record<string, [number, number]> = {
  A: [1980, 2010], B: [1981, 2011], C: [1982, 2012], D: [1983, 2013], E: [1984, 2014],
  F: [1985, 2015], G: [1986, 2016], H: [1987, 2017], J: [1988, 2018], K: [1989, 2019],
  L: [1990, 2020], M: [1991, 2021], N: [1992, 2022], P: [1993, 2023], R: [1994, 2024],
  S: [1995, 2025], T: [1996, 2026], V: [1997, 2027], W: [1998, 2028], X: [1999, 2029],
  Y: [2000, 2030], 1: [2001, 2031], 2: [2002, 2032], 3: [2003, 2033], 4: [2004, 2034],
  5: [2005, 2035], 6: [2006, 2036], 7: [2007, 2037], 8: [2008, 2038], 9: [2009, 2039],
};

export function normalizeVinInput(raw: string): { clean: string; invalidChars: string[] } {
  const upper = raw.trim().toUpperCase();
  const invalidChars = [...new Set(upper.match(/[IOQ]/g) || [])];
  const clean = upper.replace(/[^A-HJ-NPR-Z0-9]/g, "");
  return { clean, invalidChars };
}

export function decodeVinYearFromChar(yearChar: string | undefined): number | null {
  if (!yearChar) return null;
  const c = yearChar.toUpperCase();
  const pair = YEAR_CYCLES[c];
  if (!pair) return null;
  const now = new Date().getFullYear();
  const [oldYear, newYear] = pair;
  if (newYear <= now + 1) return newYear;
  return oldYear;
}

export function decodeVinYear(vin: string): number | null {
  if (vin.length < 10) return null;
  return decodeVinYearFromChar(vin[9]);
}

export async function decodeWmi(wmi: string): Promise<{ make: string | null; manufacturer: string | null }> {
  if (wmi.length < 3) return { make: null, manufacturer: null };
  try {
    const url = `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeWMI/${encodeURIComponent(wmi.slice(0, 3))}?format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return { make: null, manufacturer: null };
    const data = await res.json() as { Results?: { Make?: string; Manufacturer?: string }[] };
    const row = data.Results?.[0];
    return {
      make: row?.Make?.trim() || null,
      manufacturer: row?.Manufacturer?.trim() || null,
    };
  } catch {
    return { make: null, manufacturer: null };
  }
}

export function buildVinWarnings(errorCodes: number[], invalidChars: string[]): string[] {
  const warnings: string[] = [];
  if (invalidChars.length) {
    warnings.push(`В VIN были недопустимые символы (${invalidChars.join(", ")}). В VIN не используются буквы O, I, Q`);
  }
  if (errorCodes.includes(1)) {
    warnings.push("Контрольная цифра VIN не совпадает — марка и год подставлены по остальным данным");
  }
  if (errorCodes.includes(7)) {
    warnings.push("Автомобиль не сертифицирован для рынка США — для России и Европы это обычная ситуация");
  }
  if (errorCodes.includes(400)) {
    warnings.push("В VIN есть недопустимые символы — проверьте, что введены только латинские буквы и цифры");
  }
  if (errorCodes.includes(10)) {
    warnings.push("VIN может относиться к спецтехнике, а не к легковому авто");
  }
  return warnings;
}

export function friendlyVinError(errorCodes: number[], errorText: string | null): string {
  if (errorCodes.includes(400)) {
    return "Некорректный VIN: используйте только латинские буквы и цифры (без O, I, Q)";
  }
  if (errorText?.trim()) {
    return "Не удалось определить автомобиль по VIN. Укажите марку и модель вручную";
  }
  return "Не удалось определить автомобиль по VIN";
}
