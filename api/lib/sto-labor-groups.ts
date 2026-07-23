/** UI groups for STO labor catalog (complexes are tenant-managed). */
export const STO_LABOR_UI_GROUPS = [
  "Агрегатка",
  "АКПП ШЛИЦЫ МКПП РАЗДАТКИ",
  "ВЕНТИЛЯЦИЯ И ОТОПЛЕНИЕ",
  "ВПУСК",
  "ВЫПУСК",
  "ДВИГАТЕЛЬ",
  "ДВС",
  "ЗАДНИЙ РЕДУКТОР",
  "КАРДАНЫ",
  "КОМПРЕССОРЫ",
  "КУЗОВ",
  "МУФТЫ",
  "НА СКЛАД",
  "ПОДВЕСКА",
  "ПРОЧЕЕ",
  "РАЗДАТКИ",
  "РЕМЕННОЙ ПРИВОД",
  "РУЛЕВОЕ УПРАВЛЕНИЕ",
  "СИСТЕМА ЗАЖИГАНИЯ",
  "СИСТЕМА ОХЛАЖДЕНИЯ",
] as const;

export type StoLaborUiGroup = (typeof STO_LABOR_UI_GROUPS)[number];

const OLD_TO_GROUP: Record<string, StoLaborUiGroup> = {
  ТО: "ПРОЧЕЕ",
  Диагностика: "ПРОЧЕЕ",
  Двигатель: "ДВИГАТЕЛЬ",
  ДВС: "ДВС",
  Тормоза: "ПРОЧЕЕ",
  Подвеска: "ПОДВЕСКА",
  Рулевое: "РУЛЕВОЕ УПРАВЛЕНИЕ",
  "Рулевое управление": "РУЛЕВОЕ УПРАВЛЕНИЕ",
  Трансмиссия: "АКПП ШЛИЦЫ МКПП РАЗДАТКИ",
  Сцепление: "МУФТЫ",
  Шиномонтаж: "ПРОЧЕЕ",
  Климат: "ВЕНТИЛЯЦИЯ И ОТОПЛЕНИЕ",
  Электрика: "СИСТЕМА ЗАЖИГАНИЯ",
  Выхлоп: "ВЫПУСК",
  Топливная: "ВПУСК",
  Кузов: "КУЗОВ",
  Салон: "КУЗОВ",
  Детейлинг: "КУЗОВ",
  Слесарка: "Агрегатка",
};

export function mapLaborCategoryToGroup(category: string | null | undefined): StoLaborUiGroup {
  if (!category?.trim()) return "ПРОЧЕЕ";
  const trimmed = category.trim();
  if ((STO_LABOR_UI_GROUPS as readonly string[]).includes(trimmed)) {
    return trimmed as StoLaborUiGroup;
  }
  return OLD_TO_GROUP[trimmed] || "ПРОЧЕЕ";
}
