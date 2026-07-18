import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, gte, lt, or, isNull } from "drizzle-orm";
import { forTenant, withTenant } from "./tenant-query";
import { resolveLaborPayrollPercent } from "./labor-payroll";

export const PAYROLL_SOURCE_LABELS: Record<string, string> = {
  daily_shift: "Выход (смена)",
  receipt: "Товарный чек",
  invoice: "Расходная накладная",
  deal_parts: "Заказ запчастей",
  deal_service: "Заказ-наряд СТО",
  labor_line: "Работа в ЗН",
  buyout: "Выкуп запчастей",
};

export type PayrollLine = {
  sourceType: string;
  sourceId: number;
  sourceLabel: string;
  baseAmount: number;
  percent?: number;
  fixedAmount?: number;
  amount: number;
  ruleId?: number;
  occurredAt?: Date;
};

export type PayrollRuleView = {
  id: number;
  sourceType: string;
  label: string;
  calcType: string;
  value: number;
};

export type PayrollDayBreakdown = {
  date: string;
  worked: boolean;
  shiftPay: number;
  lines: PayrollLine[];
  dayTotal: number;
};

export type PersonalPayrollReport = {
  userId: number;
  userName: string;
  positionName: string | null;
  roleId: number | null;
  rules: PayrollRuleView[];
  from: string;
  to: string;
  days: PayrollDayBreakdown[];
  periodTotal: number;
  summary: {
    shiftTotal: number;
    commissionTotal: number;
    bySource: Record<string, number>;
  };
};

export async function getRulesForUser(userId: number, roleId: number | null) {
  const userRules = await db.select().from(schema.payrollRules).where(
    and(forTenant(schema.payrollRules), eq(schema.payrollRules.userId, userId), eq(schema.payrollRules.isActive, true)),
  );
  if (userRules.length) return userRules;

  if (!roleId) return [];
  return db.select().from(schema.payrollRules).where(
    and(forTenant(schema.payrollRules), eq(schema.payrollRules.roleId, roleId), eq(schema.payrollRules.isActive, true), isNull(schema.payrollRules.userId)),
  );
}

function applyRule(base: number, rule: typeof schema.payrollRules.$inferSelect): number {
  if (rule.calcType === "fixed") return rule.value || 0;
  return Math.round((base * (rule.value || 0) / 100) * 100) / 100;
}

function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseRange(fromStr: string, toStr: string): { start: Date; end: Date; from: string; to: string } {
  const start = new Date(`${fromStr}T00:00:00`);
  const end = new Date(`${toStr}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return { start, end, from: fromStr, to: toStr };
}

function eachDateKey(fromStr: string, toStr: string): string[] {
  const keys: string[] = [];
  const d = new Date(`${fromStr}T00:00:00`);
  const last = new Date(`${toStr}T00:00:00`);
  while (d <= last) {
    keys.push(toDateKey(d));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

export async function collectPayrollSources(
  userId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<{ sourceType: string; sourceId: number; sourceLabel: string; baseAmount: number; occurredAt: Date; precomputedAmount?: number; percent?: number }[]> {
  const sources: { sourceType: string; sourceId: number; sourceLabel: string; baseAmount: number; occurredAt: Date; precomputedAmount?: number; percent?: number }[] = [];

  const sales = await db.select().from(schema.salesDocuments).where(and(
    forTenant(schema.salesDocuments),
    eq(schema.salesDocuments.managerId, userId),
    eq(schema.salesDocuments.status, "posted"),
    gte(schema.salesDocuments.postedAt, periodStart),
    lt(schema.salesDocuments.postedAt, periodEnd),
  ));
  for (const s of sales) {
    if (!s.postedAt) continue;
    sources.push({
      sourceType: s.docType === "invoice" ? "invoice" : "receipt",
      sourceId: s.id,
      sourceLabel: `${s.docType === "invoice" ? "РН" : "ТЧ"} ${s.docNumber}`,
      baseAmount: s.totalAmount || 0,
      occurredAt: new Date(s.postedAt),
    });
  }

  const deals = await db.select().from(schema.deals).where(and(
    forTenant(schema.deals),
    eq(schema.deals.assignedTo, userId),
    gte(schema.deals.updatedAt, periodStart),
    lt(schema.deals.updatedAt, periodEnd),
    or(eq(schema.deals.status, "done"), eq(schema.deals.status, "shipped")),
  ));
  for (const d of deals) {
    if (!d.updatedAt) continue;
    sources.push({
      sourceType: d.orderType === "service" ? "deal_service" : "deal_parts",
      sourceId: d.id,
      sourceLabel: d.title,
      baseAmount: d.amount || 0,
      occurredAt: new Date(d.updatedAt),
    });
  }

  const buyouts = await db.select().from(schema.partsBuyouts).where(and(
    forTenant(schema.partsBuyouts),
    eq(schema.partsBuyouts.createdBy, userId),
    gte(schema.partsBuyouts.createdAt, periodStart),
    lt(schema.partsBuyouts.createdAt, periodEnd),
  ));
  for (const b of buyouts) {
    sources.push({
      sourceType: "buyout",
      sourceId: b.id,
      sourceLabel: b.title,
      baseAmount: b.amount,
      occurredAt: new Date(b.createdAt!),
    });
  }

  const laborRows = await db
    .select({ line: schema.dealLaborItems, deal: schema.deals })
    .from(schema.dealLaborItems)
    .innerJoin(schema.deals, eq(schema.dealLaborItems.dealId, schema.deals.id))
    .where(and(
      forTenant(schema.deals),
      eq(schema.dealLaborItems.executorUserId, userId),
      gte(schema.deals.updatedAt, periodStart),
      lt(schema.deals.updatedAt, periodEnd),
      or(eq(schema.deals.status, "done"), eq(schema.deals.status, "ready"), eq(schema.deals.status, "shipped")),
    ));

  for (const { line, deal } of laborRows) {
    if (!deal.updatedAt || !line.price || line.price <= 0) continue;
    const pct = await resolveLaborPayrollPercent(line.executorUserId, line.payrollPercent);
    if (!pct) continue;
    const commission = Math.round((line.price * pct / 100) * 100) / 100;
    if (commission <= 0) continue;
    sources.push({
      sourceType: "labor_line",
      sourceId: line.id,
      sourceLabel: `${line.name} (ЗН-${deal.id})`,
      baseAmount: line.price,
      precomputedAmount: commission,
      percent: pct,
      occurredAt: new Date(deal.updatedAt),
    });
  }

  return sources;
}

async function getWorkedDayKeys(userId: number, periodStart: Date, periodEnd: Date, sources: { occurredAt: Date }[]): Promise<Set<string>> {
  const days = new Set<string>();

  const sessions = await db.select().from(schema.userLoginSessions).where(and(
    eq(schema.userLoginSessions.userId, userId),
    gte(schema.userLoginSessions.loginAt, periodStart),
    lt(schema.userLoginSessions.loginAt, periodEnd),
  ));
  for (const s of sessions) {
    if (s.loginAt) days.add(toDateKey(new Date(s.loginAt)));
  }

  for (const src of sources) {
    days.add(toDateKey(src.occurredAt));
  }

  return days;
}

export async function calculatePayrollLines(
  userId: number,
  roleId: number | null,
  periodStart: Date,
  periodEnd: Date,
): Promise<PayrollLine[]> {
  const rules = await getRulesForUser(userId, roleId);
  const commissionRules = rules.filter((r) => r.sourceType !== "daily_shift");
  const ruleBySource = new Map<string, typeof schema.payrollRules.$inferSelect>();
  for (const r of commissionRules) ruleBySource.set(r.sourceType, r);

  const sources = await collectPayrollSources(userId, periodStart, periodEnd);
  const lines: PayrollLine[] = [];

  for (const src of sources) {
    if (src.precomputedAmount != null && src.precomputedAmount > 0) {
      lines.push({
        sourceType: src.sourceType,
        sourceId: src.sourceId,
        sourceLabel: src.sourceLabel,
        baseAmount: src.baseAmount,
        percent: src.percent,
        amount: src.precomputedAmount,
        occurredAt: src.occurredAt,
      });
      continue;
    }
    const rule = ruleBySource.get(src.sourceType);
    if (!rule || src.baseAmount <= 0) continue;
    const amount = applyRule(src.baseAmount, rule);
    if (amount <= 0) continue;
    lines.push({
      sourceType: src.sourceType,
      sourceId: src.sourceId,
      sourceLabel: src.sourceLabel,
      baseAmount: src.baseAmount,
      percent: rule.calcType === "percent" ? (rule.value ?? undefined) : undefined,
      fixedAmount: rule.calcType === "fixed" ? (rule.value ?? undefined) : undefined,
      amount,
      ruleId: rule.id,
      occurredAt: src.occurredAt,
    });
  }

  return lines;
}

export async function buildPersonalPayrollReport(
  userId: number,
  fromStr: string,
  toStr: string,
  opts?: { roleIdOverride?: number | null },
): Promise<PersonalPayrollReport | null> {
  const [user] = await db.select().from(schema.users).where(withTenant(schema.users, eq(schema.users.id, userId)));
  if (!user) return null;

  const roleId = opts?.roleIdOverride ?? user.payrollRoleId ?? null;
  let positionName: string | null = null;
  if (roleId) {
    const [role] = await db.select().from(schema.payrollRoles).where(withTenant(schema.payrollRoles, eq(schema.payrollRoles.id, roleId)));
    positionName = role?.name ?? null;
  }

  const rulesRaw = await getRulesForUser(userId, roleId);
  const rules: PayrollRuleView[] = rulesRaw.map((r) => ({
    id: r.id,
    sourceType: r.sourceType,
    label: r.label || PAYROLL_SOURCE_LABELS[r.sourceType] || r.sourceType,
    calcType: r.calcType || "percent",
    value: r.value || 0,
  }));

  const { start, end, from, to } = parseRange(fromStr, toStr);
  const allSources = await collectPayrollSources(userId, start, end);
  const allLines = await calculatePayrollLines(userId, roleId, start, end);
  const workedDays = await getWorkedDayKeys(userId, start, end, allSources);
  const shiftRule = rulesRaw.find((r) => r.sourceType === "daily_shift");

  const dateKeys = eachDateKey(fromStr, toStr);
  const days: PayrollDayBreakdown[] = [];
  let shiftTotal = 0;
  let commissionTotal = 0;
  const bySource: Record<string, number> = {};

  for (const date of dateKeys) {
    const worked = workedDays.has(date);
    let shiftPay = 0;
    if (worked && shiftRule) {
      shiftPay = shiftRule.calcType === "fixed" ? (shiftRule.value || 0) : 0;
    }

    const dayLines = allLines.filter((l) => l.occurredAt && toDateKey(l.occurredAt) === date);
    const commission = dayLines.reduce((s, l) => s + l.amount, 0);
    const dayTotal = Math.round((shiftPay + commission) * 100) / 100;

    shiftTotal += shiftPay;
    commissionTotal += commission;
    for (const l of dayLines) {
      bySource[l.sourceType] = (bySource[l.sourceType] || 0) + l.amount;
    }
    if (shiftPay > 0) {
      bySource.daily_shift = (bySource.daily_shift || 0) + shiftPay;
    }

    days.push({ date, worked, shiftPay, lines: dayLines, dayTotal });
  }

  return {
    userId,
    userName: user.name,
    positionName,
    roleId,
    rules,
    from,
    to,
    days,
    periodTotal: Math.round((shiftTotal + commissionTotal) * 100) / 100,
    summary: {
      shiftTotal: Math.round(shiftTotal * 100) / 100,
      commissionTotal: Math.round(commissionTotal * 100) / 100,
      bySource,
    },
  };
}

export function formatRuleShort(rule: PayrollRuleView): string {
  if (rule.sourceType === "daily_shift") {
    return `${rule.value.toLocaleString("ru-RU")} ₽ за выход`;
  }
  if (rule.calcType === "percent") {
    return `${rule.value}% · ${rule.label}`;
  }
  return `${rule.value.toLocaleString("ru-RU")} ₽ · ${rule.label}`;
}
