/** Коды шаблонов ZZap и подсказки по настройке в кабинете ZZap. */
export const ZZAP_TEMPLATE_CODES: Record<string, number> = {
  "Обмен-Муфты": 350016971,
  "Продажа-Муфты": 350016970,
  "Продажа-Раздатки": 600000269,
  "Обмен-раздатки": 530000467,
};

export const ZZAP_CABINET_NAMES: Record<string, string> = {
  "Обмен-Муфты": "Восстановленные муфты ОБМЕН",
  "Продажа-Муфты": "Восстановленные муфты ПРОДАЖА",
  "Продажа-Раздатки": "Восстановленные раздатки ПРОДАЖА",
  "Обмен-раздатки": "Восстановленные раздатки ОБМЕН",
};

export type ZzapTemplateKind = "exchange" | "sale";

export function zzapTemplateKind(name: string): ZzapTemplateKind {
  const n = name.toLowerCase();
  return n.includes("продажа") || n.includes("prodazha") ? "sale" : "exchange";
}

export const ZZAP_KIND_HINTS: Record<ZzapTemplateKind, string> = {
  exchange: "Поиск «Любая» — цена при обмене. В шаблоне ZZap: обычный тип, НЕ «б/у и уценка».",
  sale: "Поиск «б/у и уценка» — если в шаблоне ZZap включено «б/у и уценка». Для поиска «Любая» — снимите галочку «б/у и уценка» в настройках шаблона ПРОДАЖА.",
};
