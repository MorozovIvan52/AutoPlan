/** Кириллица → латиница (госномера РФ на СТС) */
const CYR_PLATE: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", У: "Y", Х: "X",
  а: "A", в: "B", е: "E", к: "K", м: "M", н: "H", о: "O", р: "P", с: "C", т: "T", у: "Y", х: "X",
};

/** Нормализация госномера для сравнения: A123BC77 */
export function normalizePlate(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .split("")
    .map((c) => CYR_PLATE[c] || c)
    .join("")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function platesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizePlate(a);
  const nb = normalizePlate(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length >= 5 && nb.length >= 5) {
    const coreA = na.slice(0, 6);
    const coreB = nb.slice(0, 6);
    if (coreA === coreB) return true;
  }
  return na.includes(nb) || nb.includes(na);
}

/** Форматирование для отображения: A 123 BC 77 */
export function formatPlateDisplay(raw: string): string {
  const n = normalizePlate(raw);
  if (n.length < 6) return raw.toUpperCase();
  const m = n.match(/^([A-Z])(\d{3})([A-Z]{2})(\d{2,3})$/);
  if (m) return `${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
  return n;
}
