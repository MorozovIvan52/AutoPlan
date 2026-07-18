/** Нормализация телефона РФ к 11 цифрам: 7XXXXXXXXXX */

/** Полные/обычные цифры → ASCII 0-9 */
function toAsciiDigits(raw: string): string {
  return (raw || "")
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFF10 + 0x30))
    .replace(/\D/g, "");
}

/** Нормализация телефона РФ к 11 цифрам: 7XXXXXXXXXX */
export function normalizePhoneDigits(raw: string): string {
  let d = toAsciiDigits(raw);
  if (!d) return "";
  // хвост с кодом страны, если набрали лишнее
  if (d.length > 11) {
    const tail11 = d.slice(-11);
    if (tail11.startsWith("7") || tail11.startsWith("8")) d = tail11;
    else if (d.startsWith("7") || d.startsWith("8")) d = d.slice(0, 11);
    else d = d.slice(-10);
  }
  if (d.length === 11 && d.startsWith("8")) d = `7${d.slice(1)}`;
  // 10 цифр без кода (обычно мобильный 9…)
  if (d.length === 10) d = `7${d}`;
  return d;
}

/** Последние 10 цифр национального номера (без кода страны) */
export function phoneNational10(raw: string): string {
  const n = normalizePhoneDigits(raw);
  if (n.length >= 10) return n.slice(-10);
  const rawDigits = toAsciiDigits(raw);
  return rawDigits.length >= 10 ? rawDigits.slice(-10) : rawDigits;
}

/** Варианты набора одного и того же номера для поиска */
export function phoneSearchVariants(raw: string): string[] {
  const digits = toAsciiDigits(raw);
  if (!digits) return [];
  const variants = new Set<string>();
  variants.add(digits);
  const normalized = normalizePhoneDigits(digits);
  if (normalized) {
    variants.add(normalized);
    variants.add(`8${normalized.slice(1)}`);
    variants.add(normalized.slice(1)); // без 7
  }
  if (digits.length === 10) {
    variants.add(`7${digits}`);
    variants.add(`8${digits}`);
  }
  if (digits.length === 11 && digits.startsWith("8")) {
    variants.add(`7${digits.slice(1)}`);
    variants.add(digits.slice(1));
  }
  if (digits.length === 11 && digits.startsWith("7")) {
    variants.add(`8${digits.slice(1)}`);
    variants.add(digits.slice(1));
  }
  return [...variants].filter(Boolean);
}

/** Сравнение номеров: +7, 8, без кода, с пробелами/скобками */
export function phonesMatch(stored: string | null | undefined, query: string): boolean {
  if (!stored || !query) return false;

  const s10 = phoneNational10(stored);
  const q10 = phoneNational10(query);
  if (s10.length === 10 && q10.length === 10 && s10 === q10) return true;

  const s = normalizePhoneDigits(stored);
  const q = normalizePhoneDigits(query);
  if (s && q) {
    if (q.length >= 4 && (s === q || s.includes(q) || q.includes(s))) return true;
  }

  const sRaw = toAsciiDigits(stored);
  const qRaw = toAsciiDigits(query);
  if (qRaw.length < 4 || !sRaw) return false;

  // запрос без кода (10 цифр) vs хранение с 7/8
  if (qRaw.length === 10 && (sRaw.endsWith(qRaw) || sRaw.includes(qRaw))) return true;
  if (sRaw.length === 10 && (qRaw.endsWith(sRaw) || qRaw.includes(sRaw))) return true;

  // частичное совпадение от 7 цифр (хвост номера)
  if (qRaw.length >= 7 && sRaw.endsWith(qRaw)) return true;
  if (qRaw.length >= 7 && sRaw.includes(qRaw)) return true;

  for (const v of phoneSearchVariants(query)) {
    if (v.length >= 10 && (sRaw.endsWith(v.slice(-10)) || sRaw.includes(v))) return true;
    if (s10.length === 10 && v.length >= 10 && s10 === v.slice(-10)) return true;
  }

  return false;
}
