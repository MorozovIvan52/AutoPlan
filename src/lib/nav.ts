/** Shared nav + open browser-like tabs */
export type NavItem = {
  path: string;
  icon: string;
  label: string;
  adminOnly?: boolean;
  locked?: boolean;
  badgeKey?: string;
  /** Hover flyout submenu (e.g. Money) */
  flyout?: boolean;
};

export type MoneyNavLink = {
  path: string;
  label: string;
  hint?: string;
};

/** Icons via escapes — safe across Windows/Linux file transfer encodings. */
export const NAV: NavItem[] = [
  { path: "/dashboard", icon: "\u{1F4C8}", label: "Дашборд" },
  { path: "/", icon: "\u{1F4AC}", label: "Входящие", locked: true },
  { path: "/assistant", icon: "\u{1F916}", label: "AI-боты", badgeKey: "ai-proposals" },
  { path: "/team", icon: "\u{1F465}", label: "Чаты" },
  { path: "/clients", icon: "\u{1F465}", label: "Клиенты" },
  { path: "/deals", icon: "\u{1F4E6}", label: "Заказы" },
  { path: "/zn", icon: "\u{1F6E0}", label: "ЗН" },
  { path: "/sales", icon: "\u{1F9FE}", label: "Реализация" },
  { path: "/delivery", icon: "\u{1F69A}", label: "Доставка", badgeKey: "cdek-active" },
  { path: "/money", icon: "\u{1F4B0}", label: "Деньги", flyout: true },
  { path: "/warehouse", icon: "\u{1F3ED}", label: "Склад" },
  { path: "/buyouts", icon: "\u{1F4B0}", label: "Выкуп" },
  { path: "/zzap", icon: "\u{1F527}", label: "ZZap" },
  { path: "/payroll", icon: "\u{1F4B5}", label: "Расчёт ЗП", adminOnly: true },
  { path: "/my-salary", icon: "\u{1F4B3}", label: "Моя зарплата" },
  { path: "/calendar", icon: "\u{1F4C5}", label: "Календарь" },
  { path: "/repairs", icon: "\u{1F527}", label: "Запись на ремонт" },
  { path: "/tasks", icon: "\u{2705}", label: "Задачи", badgeKey: "tasks-overdue" },
  { path: "/calls", icon: "\u{1F4DE}", label: "Звонки" },
  { path: "/marketing", icon: "\u{1F4E3}", label: "Рассылки" },
  { path: "/analytics", icon: "\u{1F4CA}", label: "Отчёты", adminOnly: true },
  { path: "/settings", icon: "\u{2699}", label: "Настройки", locked: true },
];

/** АвтоДилер-подобное подменю «Деньги» */
export const MONEY_PRIMARY: MoneyNavLink[] = [
  { path: "/money/cash-orders", label: "ПКО / РКО" },
  { path: "/money", label: "Движение денежных средств" },
  { path: "/money/bank-statements", label: "Банковские выписки" },
];

export const MONEY_RELATED: MoneyNavLink[] = [
  {
    path: "/money/cashflow-report",
    label: "Отчёт о Движении Денежных Средств",
    hint: "Все поступления и выплаты за период",
  },
  {
    path: "/money/bank-import",
    label: "Загрузка банковских выписок",
    hint: "Автоматизация учёта по выписке",
  },
  {
    path: "/money/charts",
    label: "Графики",
    hint: "Обзор операций для руководителя",
  },
  {
    path: "/money/client-advances",
    label: "Авансы клиентов и распределение платежа",
    hint: "Предоплаты клиентов",
  },
  {
    path: "/money/supplier-advances",
    label: "Аванс поставщику",
    hint: "Предоплаты поставщикам",
  },
];

export function labelForPath(path: string): string {
  if (path.startsWith("/zn/")) return `ЗН № ${path.split("/")[2] || ""}`;
  if (path.startsWith("/money")) {
    const all = [...MONEY_PRIMARY, ...MONEY_RELATED];
    const hit = all.find((n) => n.path === path);
    if (hit) return hit.label;
    return "Деньги";
  }
  const exact = NAV.find((n) => n.path === path);
  if (exact) return exact.label;
  const prefix = NAV.filter((n) => n.path !== "/" && path.startsWith(n.path)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  return prefix?.label || path;
}

export function iconForPath(path: string): string {
  if (path.startsWith("/zn/")) return "\u{1F6E0}";
  if (path.startsWith("/money")) return "\u{1F4B0}";
  const exact = NAV.find((n) => n.path === path);
  if (exact) return exact.icon;
  const prefix = NAV.filter((n) => n.path !== "/" && path.startsWith(n.path)).sort(
    (a, b) => b.path.length - a.path.length,
  )[0];
  return prefix?.icon || "\u{1F4C4}";
}
