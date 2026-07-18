export type WarrantyTemplate = { id: string; title: string; text: string };

export const DEFAULT_PARTS_WARRANTY: WarrantyTemplate[] = [
  {
    id: "parts-14",
    title: "Запчасти 14 дней",
    text: "Гарантия на запчасти 14 календарных дней с даты продажи. Гарантия не распространяется на механические повреждения, неправильную установку и естественный износ.",
  },
  {
    id: "parts-30",
    title: "Запчасти 30 дней",
    text: "Гарантия на запчасти 30 календарных дней с даты продажи. Обмен или возврат возможен при сохранении товарного вида, упаковки и отсутствии следов установки.",
  },
  {
    id: "used",
    title: "Б/у деталь",
    text: "Товар продаётся как б/у. Гарантия 7 календарных дней только на скрытые заводские дефекты. Установка и проверка совместимости выполняются покупателем.",
  },
  {
    id: "no-warranty",
    title: "Без гарантии",
    text: "Товар продаётся без гарантии. Претензии по внешнему виду и комплектации принимаются только в момент выдачи.",
  },
];

export function parseWarrantyTemplates(raw?: string | null): WarrantyTemplate[] {
  if (!raw?.trim()) return DEFAULT_PARTS_WARRANTY;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_PARTS_WARRANTY;
    const items = parsed
      .map((row, index) => {
        if (!row || typeof row !== "object") return null;
        const title = typeof row.title === "string" ? row.title.trim() : "";
        const text = typeof row.text === "string" ? row.text.trim() : "";
        if (!title || !text) return null;
        return {
          id: typeof row.id === "string" && row.id.trim() ? row.id.trim() : `tpl-${index + 1}`,
          title,
          text,
        } satisfies WarrantyTemplate;
      })
      .filter(Boolean) as WarrantyTemplate[];
    return items.length ? items : DEFAULT_PARTS_WARRANTY;
  } catch {
    return DEFAULT_PARTS_WARRANTY;
  }
}

export function mergeWarrantyTemplates(raw?: string | null, includeSto = false): WarrantyTemplate[] {
  const custom = raw?.trim() ? parseWarrantyTemplates(raw) : [];
  const base = includeSto ? [...DEFAULT_PARTS_WARRANTY, ...custom] : [...DEFAULT_PARTS_WARRANTY, ...custom];
  const seen = new Set<string>();
  return base.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

export function serializeWarrantyTemplates(templates: WarrantyTemplate[]): string {
  return JSON.stringify(templates);
}
