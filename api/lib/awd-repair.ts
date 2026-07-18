export type AwdServiceItem = {
  id: string;
  label: string;
  hours: number;
  laborRate: number;
  partsEstimate: number;
};

export const AWD_REPAIR_ITEMS: AwdServiceItem[] = [
  { id: "diag", label: "Диагностика полного привода", hours: 1.5, laborRate: 2500, partsEstimate: 0 },
  { id: "oil_transfer", label: "Замена масла в раздаточной коробке", hours: 0.8, laborRate: 2500, partsEstimate: 1800 },
  { id: "oil_diff_front", label: "Замена масла переднего редуктора", hours: 0.6, laborRate: 2500, partsEstimate: 1500 },
  { id: "oil_diff_rear", label: "Замена масла заднего редуктора", hours: 0.6, laborRate: 2500, partsEstimate: 1500 },
  { id: "cv_joint", label: "Замена ШРУС (1 сторона)", hours: 2.5, laborRate: 2500, partsEstimate: 8500 },
  { id: "cardan", label: "Замена карданного вала / крестовины", hours: 2, laborRate: 2500, partsEstimate: 12000 },
  { id: "hub_bearing", label: "Замена ступичного подшипника", hours: 1.8, laborRate: 2500, partsEstimate: 6500 },
  { id: "transfer_seal", label: "Замена сальников раздатки", hours: 3, laborRate: 2500, partsEstimate: 3500 },
  { id: "diff_repair", label: "Ремонт дифференциала (разборка, регулировка)", hours: 6, laborRate: 2800, partsEstimate: 15000 },
  { id: "awd_coupling", label: "Замена муфты полного привода (Haldex и аналоги)", hours: 3.5, laborRate: 2800, partsEstimate: 28000 },
];

export function calcAwdQuote(selectedIds: string[]): {
  items: Array<AwdServiceItem & { labor: number; total: number }>;
  laborTotal: number;
  partsTotal: number;
  grandTotal: number;
  estimatedDays: number;
} {
  const items = AWD_REPAIR_ITEMS
    .filter((i) => selectedIds.includes(i.id))
    .map((i) => {
      const labor = Math.round(i.hours * i.laborRate);
      const total = labor + i.partsEstimate;
      return { ...i, labor, total };
    });

  const laborTotal = items.reduce((s, i) => s + i.labor, 0);
  const partsTotal = items.reduce((s, i) => s + i.partsEstimate, 0);
  const totalHours = items.reduce((s, i) => s + i.hours, 0);
  const estimatedDays = Math.max(1, Math.ceil(totalHours / 8));

  return {
    items,
    laborTotal,
    partsTotal,
    grandTotal: laborTotal + partsTotal,
    estimatedDays,
  };
}

export function formatAwdQuoteText(
  selectedIds: string[],
  vehicle?: { make?: string; model?: string; plate?: string; vin?: string },
): string {
  const q = calcAwdQuote(selectedIds);
  if (!q.items.length) return "Выберите работы для расчёта.";

  const car = [vehicle?.make, vehicle?.model, vehicle?.plate].filter(Boolean).join(" ");
  const lines = [
    "Калькуляция: ремонт полного привода",
    car ? `Авто: ${car}` : "",
    vehicle?.vin ? `VIN: ${vehicle.vin}` : "",
    "",
    "Работы:",
    ...q.items.map((i) => `• ${i.label} — ${i.total.toLocaleString("ru-RU")} ₽ (работа ${i.labor.toLocaleString("ru-RU")} ₽ + запчасти ~${i.partsEstimate.toLocaleString("ru-RU")} ₽)`),
    "",
    `Работа: ${q.laborTotal.toLocaleString("ru-RU")} ₽`,
    `Запчасти (ориентир): ${q.partsTotal.toLocaleString("ru-RU")} ₽`,
    `Итого: ${q.grandTotal.toLocaleString("ru-RU")} ₽`,
    `Срок: ~${q.estimatedDays} раб. дн.`,
    "",
    "Точная стоимость после осмотра и подбора запчастей по VIN.",
  ].filter(Boolean);

  return lines.join("\n");
}
