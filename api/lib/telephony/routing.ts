import { db } from "../../database";
import * as schema from "../../database/schema";
import { eq, and } from "drizzle-orm";
import { findUserByExtension, getTelephonySettings } from "./common";
import { forTenant, withTenant } from "../tenant-query";

export type CallRouteResult = {
  userId: number | null;
  extension: string | null;
  userName: string | null;
  source: "deal" | "load_balance" | "megafon" | "default";
};

function parseLoadBalanceUserIds(raw?: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0);
  } catch {
    return [];
  }
}

export async function findManagerByClient(clientId: number): Promise<CallRouteResult | null> {
  const deals = await db.select().from(schema.deals)
    .where(and(forTenant(schema.deals), eq(schema.deals.clientId, clientId)));
  const active = deals.find((d) => d.status !== "done" && d.status !== "cancelled");
  if (!active?.assignedTo) return null;

  const [mgr] = await db.select().from(schema.users)
    .where(withTenant(schema.users, eq(schema.users.id, active.assignedTo)));
  if (!mgr?.isActive || !mgr.phoneExtension) return null;

  return {
    userId: mgr.id,
    extension: mgr.phoneExtension,
    userName: mgr.name,
    source: "deal",
  };
}

async function getLoadBalancePool(explicitIds: number[]) {
  const users = await db.select().from(schema.users)
    .where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
  const withExt = users.filter((u) => u.phoneExtension);
  if (!explicitIds.length) return withExt;
  const idSet = new Set(explicitIds);
  return withExt.filter((u) => idSet.has(u.id));
}

export async function pickLoadBalancedManager(): Promise<CallRouteResult | null> {
  const settings = await getTelephonySettings();
  if (!settings.callLoadBalanceEnabled) return null;

  const pool = await getLoadBalancePool(parseLoadBalanceUserIds(settings.callLoadBalanceUserIds));
  if (!pool.length) return null;

  const index = settings.callLoadBalanceIndex ?? 0;
  const manager = pool[index % pool.length];

  await db.update(schema.telephonySettings).set({
    callLoadBalanceIndex: (index + 1) % pool.length,
    updatedAt: new Date(),
  }).where(eq(schema.telephonySettings.id, settings.id));

  return {
    userId: manager.id,
    extension: manager.phoneExtension!,
    userName: manager.name,
    source: "load_balance",
  };
}

export async function resolveIncomingCallRoute(opts: {
  clientId?: number | null;
  fallbackNumber?: string | null;
  megafonOperatorExt?: string | null;
}): Promise<CallRouteResult> {
  if (opts.megafonOperatorExt) {
    const user = await findUserByExtension(opts.megafonOperatorExt);
    if (user) {
      return {
        userId: user.id,
        extension: user.phoneExtension,
        userName: user.name,
        source: "megafon",
      };
    }
  }

  if (opts.clientId) {
    const byDeal = await findManagerByClient(opts.clientId);
    if (byDeal) return byDeal;
  }

  const balanced = await pickLoadBalancedManager();
  if (balanced) return balanced;

  return {
    userId: null,
    extension: opts.fallbackNumber?.trim() || null,
    userName: null,
    source: "default",
  };
}
