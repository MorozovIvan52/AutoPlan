import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { parse } from "csv-parse/sync";
import { jsonApiError } from "../lib/api-error";

export const importsRoute = new Hono()
  .post("/csv", async (c) => {
    const tenantId = c.get("tenantId") as number | undefined;
    if (!tenantId) return c.json({ error: "Tenant not resolved" }, 400);

    const text = await c.req.text().catch(() => "");
    if (!text) return c.json({ error: "No CSV body" }, 400);

    try {
      const records = parse(text, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
      const created: any[] = [];
      for (const r of records) {
        const name = (r.name || r["Name"] || "").toString().trim();
        const phone = (r.phone || r['Phone'] || "").toString().trim();
        const plate = (r.plate || r['Plate'] || r['plate'] || "").toString().trim();
        const vin = (r.vin || r['VIN'] || "").toString().trim();

        if (!name && !phone) continue;
        const [client] = await db.insert(schema.clients).values({
          name: name || phone,
          phone: phone || null,
          isDemo: false,
          tenantId,
        }).returning();

        if (plate || vin) {
          await db.insert(schema.vehicles).values({
            clientId: client.id,
            plate: plate || null,
            vin: vin || null,
          });
        }
        created.push({ clientId: client.id, name: client.name });
      }
      return c.json({ ok: true, created }, 200);
    } catch (e: any) {
      return jsonApiError(c, e, "CSV parse error", 500, "imports_csv");
    }
  });
