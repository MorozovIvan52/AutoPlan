/**
 * ═══════════════════════════════════════════════════════════════════
 * api/lib/quota-enforcement.ts
 * Система проверки и enforcement лимитов по тарифу
 * ═══════════════════════════════════════════════════════════════════
 */

import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, gte, desc } from "drizzle-orm";
import { getPlanLimits } from "./tenant";

/**
 * Типы лимитов
 */
export type QuotaType =
  | "users"
  | "channels"
  | "storage"
  | "conversations"
  | "api_calls"
  | "vin_decodes"
  | "stock_skus"
  | "call_minutes";

export interface QuotaInfo {
  type: QuotaType;
  used: number;
  limit: number;
  remaining: number;
  percentage: number;
  isExceeded: boolean;
  isWarning: boolean; // > 80%
}

/**
 * Получить информацию по всем лимитам тенанта
 */
export async function getTenantQuotas(tenantId: number): Promise<Record<QuotaType, QuotaInfo>> {
  const tenant = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant.length) throw new Error("Tenant not found");

  const plan = getPlanLimits(tenant[0]!.subscriptionPlan);

  // Подсчитываем использование
  const users = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.isActive, true)));

  const channels = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.tenantId, tenantId), eq(schema.channels.isActive, true)));

  const usage = await db
    .select()
    .from(schema.tenantUsage)
    .where(eq(schema.tenantUsage.tenantId, tenantId))
    .orderBy(desc(schema.tenantUsage.recordedAt))
    .limit(1);

  const usageData = usage[0];

  // Формируем квоты
  const quotas: Record<QuotaType, QuotaInfo> = {
    users: {
      type: "users",
      used: users.length,
      limit: plan.maxUsers,
      remaining: Math.max(0, plan.maxUsers - users.length),
      percentage: Math.round((users.length / plan.maxUsers) * 100),
      isExceeded: users.length > plan.maxUsers,
      isWarning: users.length > plan.maxUsers * 0.8,
    },
    channels: {
      type: "channels",
      used: channels.length,
      limit: plan.maxChannels,
      remaining: Math.max(0, plan.maxChannels - channels.length),
      percentage: Math.round((channels.length / plan.maxChannels) * 100),
      isExceeded: channels.length > plan.maxChannels,
      isWarning: channels.length > plan.maxChannels * 0.8,
    },
    storage: {
      type: "storage",
      used: usageData?.storageUsedGb || 0,
      limit: plan.maxStorageGb,
      remaining: Math.max(0, plan.maxStorageGb - (usageData?.storageUsedGb || 0)),
      percentage: Math.round(((usageData?.storageUsedGb || 0) / plan.maxStorageGb) * 100),
      isExceeded: (usageData?.storageUsedGb || 0) > plan.maxStorageGb,
      isWarning: (usageData?.storageUsedGb || 0) > plan.maxStorageGb * 0.8,
    },
    conversations: {
      type: "conversations",
      used: usageData?.conversationsThisMonth || 0,
      limit: plan.maxChannels * 10, // Примерное значение
      remaining: Math.max(0, plan.maxChannels * 10 - (usageData?.conversationsThisMonth || 0)),
      percentage: Math.round(((usageData?.conversationsThisMonth || 0) / (plan.maxChannels * 10)) * 100),
      isExceeded: (usageData?.conversationsThisMonth || 0) > plan.maxChannels * 10,
      isWarning: (usageData?.conversationsThisMonth || 0) > plan.maxChannels * 10 * 0.8,
    },
    api_calls: {
      type: "api_calls",
      used: usageData?.apiCallsToday || 0,
      limit: 1000, // По умолчанию
      remaining: Math.max(0, 1000 - (usageData?.apiCallsToday || 0)),
      percentage: Math.round(((usageData?.apiCallsToday || 0) / 1000) * 100),
      isExceeded: (usageData?.apiCallsToday || 0) > 1000,
      isWarning: (usageData?.apiCallsToday || 0) > 1000 * 0.8,
    },
    // Заглушки тарифов СТО — пока не блокируют
    vin_decodes: stubQuota("vin_decodes", usageData?.vinDecodesUsed ?? 0, 500),
    stock_skus: stubQuota("stock_skus", usageData?.stockSkusActive ?? 0, 5000),
    call_minutes: stubQuota("call_minutes", usageData?.callMinutesUsed ?? 0, 1000),
  };

  return quotas;
}

function stubQuota(type: QuotaType, used: number, softLimit: number): QuotaInfo {
  const safeUsed = used ?? 0;
  return {
    type,
    used: safeUsed,
    limit: softLimit,
    remaining: Math.max(0, softLimit - safeUsed),
    percentage: softLimit > 0 ? Math.round((safeUsed / softLimit) * 100) : 0,
    isExceeded: false,
    isWarning: softLimit > 0 && safeUsed > softLimit * 0.8,
  };
}

/**
 * Проверить конкретный лимит
 */
export async function checkQuota(tenantId: number, type: QuotaType): Promise<QuotaInfo> {
  const quotas = await getTenantQuotas(tenantId);
  return quotas[type]!;
}

/**
 * Заглушка учёта квот СТО: всегда allowed, пишет лог и инкрементирует счётчик.
 */
export async function logQuotaUsage(
  tenantIdNum: number,
  type: "vin_decodes" | "stock_skus" | "call_minutes",
  delta = 1,
): Promise<{ allowed: true; used: number }> {
  const column =
    type === "vin_decodes" ? "vinDecodesUsed"
      : type === "stock_skus" ? "stockSkusActive"
        : "callMinutesUsed";

  const existing = await db
    .select()
    .from(schema.tenantUsage)
    .where(eq(schema.tenantUsage.tenantId, tenantIdNum))
    .limit(1);

  let used = delta;
  if (existing.length) {
    const prev = Number(existing[0]![column] ?? 0);
    used = prev + delta;
    await db
      .update(schema.tenantUsage)
      .set({ [column]: used, recordedAt: new Date() })
      .where(eq(schema.tenantUsage.tenantId, tenantIdNum));
  } else {
    await db.insert(schema.tenantUsage).values({
      tenantId: tenantIdNum,
      [column]: used,
      recordedAt: new Date(),
    });
  }

  console.info(JSON.stringify({
    event: "quota_usage",
    tenantId: tenantIdNum,
    type,
    delta,
    used,
    allowed: true,
  }));

  return { allowed: true, used };
}

/**
 * Проверить, может ли тенант создать нового пользователя
 */
export async function canCreateUser(tenantId: number): Promise<{
  allowed: boolean;
  reason?: string;
  quota?: QuotaInfo;
}> {
  const quota = await checkQuota(tenantId, "users");

  if (quota.used >= quota.limit) {
    return {
      allowed: false,
      reason: `Вы достигли лимита ${quota.limit} пользователей по вашему тарифу`,
      quota,
    };
  }

  return { allowed: true, quota };
}

/**
 * Проверить, может ли тенант создать новый канал
 */
export async function canCreateChannel(tenantId: number): Promise<{
  allowed: boolean;
  reason?: string;
  quota?: QuotaInfo;
}> {
  const quota = await checkQuota(tenantId, "channels");

  if (quota.used >= quota.limit) {
    return {
      allowed: false,
      reason: `Вы достигли лимита ${quota.limit} каналов по вашему тарифу`,
      quota,
    };
  }

  return { allowed: true, quota };
}

/**
 * Проверить доступное хранилище
 */
export async function canUploadFile(
  tenantId: number,
  fileSizeGb: number
): Promise<{
  allowed: boolean;
  reason?: string;
  quota?: QuotaInfo;
}> {
  const quota = await checkQuota(tenantId, "storage");

  if (quota.remaining < fileSizeGb) {
    return {
      allowed: false,
      reason: `Недостаточно хранилища. Свободно: ${quota.remaining.toFixed(1)}GB, требуется: ${fileSizeGb}GB`,
      quota,
    };
  }

  return { allowed: true, quota };
}

/**
 * Обновить счётчик использования
 */
export async function updateUsage(tenantId: number) {
  const users = await db
    .select()
    .from(schema.users)
    .where(and(eq(schema.users.tenantId, tenantId), eq(schema.users.isActive, true)));

  const channels = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.tenantId, tenantId), eq(schema.channels.isActive, true)));

  // Считаем диалоги за текущий месяц
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const conversations = await db
    .select()
    .from(schema.conversations)
    .where(
      and(
        eq(schema.conversations.tenantId, tenantId),
        gte(schema.conversations.createdAt, monthStart),
      ),
    );

  // Обновляем или создаём запись
  const existing = await db
    .select()
    .from(schema.tenantUsage)
    .where(eq(schema.tenantUsage.tenantId, tenantId))
    .limit(1);

  if (existing.length) {
    await db
      .update(schema.tenantUsage)
      .set({
        activeUsers: users.length,
        activeChannels: channels.length,
        conversationsThisMonth: conversations.length,
        recordedAt: new Date(),
      })
      .where(eq(schema.tenantUsage.tenantId, tenantId));
  } else {
    await db.insert(schema.tenantUsage).values({
      tenantId,
      activeUsers: users.length,
      activeChannels: channels.length,
      conversationsThisMonth: conversations.length,
      recordedAt: new Date(),
    });
  }

  try {
    const parts = await db
      .select({ id: schema.partsStock.id })
      .from(schema.partsStock)
      .where(eq(schema.partsStock.tenantId, tenantId));
    await db
      .update(schema.tenantUsage)
      .set({ stockSkusActive: parts.length, recordedAt: new Date() })
      .where(eq(schema.tenantUsage.tenantId, tenantId));
    console.info(JSON.stringify({
      event: "quota_usage",
      tenantId,
      type: "stock_skus",
      used: parts.length,
      allowed: true,
    }));
  } catch (e) {
    console.warn("[quota] stock_skus refresh skipped:", (e as Error)?.message || e);
  }
}

/**
 * Восстановить сработавший лимит (например, после upgrade)
 */
export async function resetQuotaLimits(tenantId: number) {
  await updateUsage(tenantId);
}
