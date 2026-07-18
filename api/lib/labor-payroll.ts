import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, isNull } from "drizzle-orm";
import { forTenant, withTenant } from "./tenant-query";

async function getRulesForUser(userId: number, roleId: number | null) {
  const userRules = await db.select().from(schema.payrollRules).where(
    and(forTenant(schema.payrollRules), eq(schema.payrollRules.userId, userId), eq(schema.payrollRules.isActive, true)),
  );
  if (userRules.length) return userRules;
  if (!roleId) return [];
  return db.select().from(schema.payrollRules).where(
    and(
      forTenant(schema.payrollRules),
      eq(schema.payrollRules.roleId, roleId),
      eq(schema.payrollRules.isActive, true),
      isNull(schema.payrollRules.userId),
    ),
  );
}

/** Процент ЗП по умолчанию для механика (из правил роли или 8%). */
export async function getDefaultLaborPayrollPercent(userId: number): Promise<number> {
  const [user] = await db.select().from(schema.users).where(withTenant(schema.users, eq(schema.users.id, userId)));
  if (!user) return 8;

  const rules = await getRulesForUser(userId, user.payrollRoleId ?? null);
  const laborRule = rules.find((r) => r.sourceType === "labor_line")
    || rules.find((r) => r.sourceType === "deal_service");
  if (laborRule?.calcType === "percent" && laborRule.value) return laborRule.value;
  return 8;
}

export async function resolveLaborPayrollPercent(
  userId: number | null | undefined,
  linePercent: number | null | undefined,
): Promise<number | null> {
  if (linePercent != null && linePercent > 0) return linePercent;
  if (!userId) return null;
  return getDefaultLaborPayrollPercent(userId);
}
