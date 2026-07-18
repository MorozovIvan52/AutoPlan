/**
 * E2E admin user (tenant #1). Идемпотентно.
 */
import "../load-env.ts";
import { db } from "../api/database/index.ts";
import * as schema from "../api/database/schema.ts";
import { eq } from "drizzle-orm";
import { hashPassword } from "../api/lib/password.ts";
import { DEFAULT_TENANT_ID } from "../api/lib/tenant-bootstrap.ts";
import { closeDatabase } from "../api/database/index.ts";

const email = (process.env.E2E_LOGIN || "e2e@crm.local").trim().toLowerCase();
const password = process.env.E2E_PASSWORD || "E2eTest123!";

async function main() {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) {
    console.log(`[e2e-user] Уже есть: ${email} (id=${existing.id})`);
    return;
  }

  const [tenant] = await db.select().from(schema.tenants).where(eq(schema.tenants.id, DEFAULT_TENANT_ID)).limit(1);
  if (!tenant) {
    await db.insert(schema.tenants).values({
      id: DEFAULT_TENANT_ID,
      slug: "default",
      name: "E2E Tenant",
      subscriptionStatus: "active",
      subscriptionPlan: "business",
      maxUsers: 25,
      isActive: true,
    });
  }

  const passwordHash = await hashPassword(password);
  const [user] = await db.insert(schema.users).values({
    name: "E2E Admin",
    email,
    passwordHash,
    role: "admin",
    tenantId: DEFAULT_TENANT_ID,
    isActive: true,
  }).returning();

  console.log(`[e2e-user] Создан: ${email} (id=${user!.id})`);
}

main()
  .catch((e) => {
    console.error("[e2e-user]", e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
