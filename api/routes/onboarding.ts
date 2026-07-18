import { Hono } from "hono";
import { provisionTenant } from "../lib/tenant";
import { db } from "../database";
import * as schema from "../database/schema";
import { nanoid } from "nanoid";
import { jsonApiError } from "../lib/api-error";

export const onboarding = new Hono()
  .post("/test-tenant", async (c) => {
    try {
      const rnd = nanoid(6).toLowerCase();
      const companyName = `Demo Company ${rnd}`;
      const adminEmail = `demo+${rnd}@example.com`;
      const adminPassword = `Demo!${Math.random().toString(36).slice(2, 10)}A1`;

      const adminName = "Demo Admin";
      const { tenant, admin } = await provisionTenant({
        companyName,
        subdomain: `demo-${rnd}`,
        adminName,
        adminEmail,
        adminPassword,
        plan: "start",
        trialDays: 14,
      });

      // Seed minimal demo data for this tenant
      await db.insert(schema.clients).values({
        name: "Иван Демон",
        phone: "+79000000000",
        isDemo: true,
        tenantId: tenant.id,
      });

      // Return credentials
      return c.json({ ok: true, tenant, admin: { id: admin.id, email: admin.email, password: adminPassword } }, 201);
    } catch (e: any) {
      return jsonApiError(c, e, "Ошибка создания демо", 500, "onboarding_demo");
    }
  });
