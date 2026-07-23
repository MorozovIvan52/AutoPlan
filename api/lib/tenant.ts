import { db } from "../database";
import { sqlGet } from "../database/raw-sql";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { DEFAULT_TENANT_ID } from "./tenant-bootstrap";
import { hashPassword } from "./password";

export type SubscriptionStatus = "active" | "trial" | "expired" | "suspended";

export type PlanName = "start" | "business" | "enterprise";

export type TenantRow = {
  id: number;
  slug: string;
  name: string;
  subdomain: string | null;
  subscriptionStatus: SubscriptionStatus;
  subscriptionPlan: string | null;
  trialEndsAt: Date | null;
  maxUsers: number;
  isActive: boolean;
};

function mapTenant(row: typeof schema.tenants.$inferSelect): TenantRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    subdomain: row.subdomain ?? null,
    subscriptionStatus: row.subscriptionStatus as SubscriptionStatus,
    subscriptionPlan: row.subscriptionPlan ?? null,
    trialEndsAt: row.trialEndsAt ?? null,
    maxUsers: row.maxUsers ?? 3,
    isActive: row.isActive ?? true,
  };
}

export function getPlanLimits(plan: string | null | undefined) {
  switch (plan) {
    case "enterprise":
      return { maxUsers: 100, maxChannels: 20, maxStorageGb: 100 };
    case "business":
      return { maxUsers: 25, maxChannels: 10, maxStorageGb: 20 };
    case "start":
    default:
      return { maxUsers: 3, maxChannels: 3, maxStorageGb: 5 };
  }
}

export function canCreateMoreUsers(currentActiveUsers: number, tenantMaxUsers: number | undefined): boolean {
  return currentActiveUsers < (tenantMaxUsers ?? 3);
}

export async function getTenantById(id: number): Promise<TenantRow | null> {
  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, id));
  return row ? mapTenant(row) : null;
}

export async function getTenantBySlug(slug: string): Promise<TenantRow | null> {
  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.slug, slug));
  return row ? mapTenant(row) : null;
}

export async function getTenantBySubdomain(subdomain: string): Promise<TenantRow | null> {
  const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.subdomain, subdomain));
  return row ? mapTenant(row) : null;
}

/** Поддомен из Host: client1.crmavito.online → client1 */
export function parseSubdomainFromHost(host: string | undefined): string | null {
  if (!host) return null;
  const h = host.split(":")[0]!.toLowerCase();
  // localhost / IP — не поддомен (иначе 127.0.0.1 → "127")
  if (h === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return null;
  const base = (process.env.TENANT_BASE_DOMAIN || "").trim().toLowerCase();
  if (base && h.endsWith(`.${base}`)) {
    const sub = h.slice(0, -(base.length + 1));
    if (sub && sub !== "www" && !sub.includes(".")) return sub;
  }
  const parts = h.split(".");
  if (parts.length >= 3 && parts[0] !== "www") return parts[0]!;
  return null;
}

export function subscriptionAllowsAccess(tenant: TenantRow): boolean {
  if (!tenant.isActive) return false;
  if (tenant.subscriptionStatus === "active") return true;
  if (tenant.subscriptionStatus === "trial") {
    if (!tenant.trialEndsAt) return true;
    return tenant.trialEndsAt.getTime() > Date.now();
  }
  return false;
}

export function subscriptionAllowsMutations(tenant: TenantRow): boolean {
  return subscriptionAllowsAccess(tenant);
}

export async function resolveTenantFromRequest(opts: {
  host?: string;
  headerTenantId?: string;
  headerTenantSlug?: string;
}): Promise<TenantRow | null> {
  if (opts.headerTenantId) {
    const id = Number(opts.headerTenantId);
    if (Number.isFinite(id) && id > 0) {
      const t = await getTenantById(id);
      if (t) return t;
    }
  }
  if (opts.headerTenantSlug) {
    const t = await getTenantBySlug(opts.headerTenantSlug.trim());
    if (t) return t;
  }
  const sub = parseSubdomainFromHost(opts.host);
  if (sub) {
    const bySub = await getTenantBySubdomain(sub);
    if (bySub) return bySub;
    return getTenantBySlug(sub);
  }
  // If host is a custom domain stored in tenants.subdomain (full domain), try exact match
  if (opts.host) {
    const hostNormalized = opts.host.split(":")[0]!.toLowerCase();
    const [row] = await db.select().from(schema.tenants).where(eq(schema.tenants.subdomain, hostNormalized));
    if (row) return mapTenant(row);

    // Явный apex-хост (не «тихий» fallback на любой неизвестный host → 1)
    const rootDomain = (process.env.CRM_ROOT_DOMAIN || "").trim().toLowerCase();
    if (rootDomain) {
      const isRoot =
        hostNormalized === rootDomain || hostNormalized === `www.${rootDomain}`;
      if (isRoot) {
        const rootId = Number(process.env.CRM_ROOT_TENANT_ID || DEFAULT_TENANT_ID);
        if (Number.isFinite(rootId) && rootId > 0) {
          return getTenantById(rootId);
        }
      }
    }
  }
  return null;
}

function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "tenant";
}

export async function provisionTenant(opts: {
  companyName: string;
  subdomain?: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  plan?: string;
  trialDays?: number;
}) {
  const email = opts.adminEmail.trim().toLowerCase();
  const slug = slugify(opts.subdomain || opts.companyName);
  const subdomain = (opts.subdomain || slug).trim().toLowerCase();
  const trialDays = opts.trialDays ?? 14;
  const trialEnds = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
  const passwordHash = await hashPassword(opts.adminPassword);

  return db.transaction(async (tx) => {
    const existingSlug = await tx.select().from(schema.tenants).where(eq(schema.tenants.slug, slug)).limit(1);
    if (existingSlug.length) throw new Error("Организация с таким идентификатором уже существует");

    const existingSub = await tx.select().from(schema.tenants).where(eq(schema.tenants.subdomain, subdomain)).limit(1);
    if (existingSub.length) throw new Error("Поддомен уже занят");

    const existingUser = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existingUser.length) throw new Error("Пользователь с таким email уже зарегистрирован");

    const plan = (opts.plan || "start") as PlanName;
    const limits = getPlanLimits(plan);
    const [tenant] = await tx.insert(schema.tenants).values({
      slug,
      name: opts.companyName.trim(),
      subdomain,
      subscriptionStatus: "trial",
      subscriptionPlan: plan,
      trialEndsAt: trialEnds,
      maxUsers: limits.maxUsers,
      isActive: true,
    }).returning();

    const [admin] = await tx.insert(schema.users).values({
      name: opts.adminName.trim() || "Администратор",
      email,
      passwordHash,
      role: "admin",
      tenantId: tenant!.id,
    }).returning();

    await tx.insert(schema.tags).values([
      { name: "Подбор по VIN", color: "#2563eb", tenantId: tenant!.id },
      { name: "СТО", color: "#06b6d4", tenantId: tenant!.id },
      { name: "Авито", color: "#00aaff", tenantId: tenant!.id },
    ]);

    await tx.insert(schema.crmSettings).values({ tenantId: tenant!.id, companyName: opts.companyName.trim() });

    return { tenant: mapTenant(tenant!), admin };
  });
}

/** Adoption: пользователи с ≥3 целевыми действиями за период */
export async function computeAdoptionRate(tenantId: number, days = 7): Promise<{
  totalUsers: number;
  activeUsers: number;
  adoptionRate: number;
}> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  const targetEvents = ["deal_created", "deal_updated", "client_created", "vin_lookup", "message_sent", "task_completed"];

  const totalRow = await sqlGet<{ n: number }>(
    "SELECT COUNT(*) AS n FROM users WHERE tenant_id = ? AND is_active = 1 AND role != 'demo'",
    tenantId,
  );

  const activeRow = await sqlGet<{ n: number }>(`
    SELECT COUNT(*) AS n FROM (
      SELECT e.user_id FROM user_activity_events e
      JOIN users u ON u.id = e.user_id
      WHERE u.tenant_id = ? AND e.created_at >= ?
        AND e.event_type IN (${targetEvents.map(() => "?").join(",")})
      GROUP BY e.user_id
      HAVING COUNT(*) >= 3
    )
  `, tenantId, since, ...targetEvents);

  const activeUsers = activeRow?.n || 0;
  const totalUsers = totalRow?.n || 0;
  const adoptionRate = totalUsers > 0 ? Math.round((activeUsers / totalUsers) * 100) : 0;
  return { totalUsers, activeUsers, adoptionRate };
}
