import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { and, asc, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { forTenant } from "../lib/tenant-query";
import { csvBool, csvDate, paginate, streamCsv } from "../lib/csv-stream";

export const exportRoute = new Hono()
  .use("*", requireAuth)

  .get("/clients.csv", async (c) => {
    const headers = [
      "id", "name", "phone", "email", "source", "loyaltyCard",
      "discountPercent", "notes", "isDemo", "createdAt", "updatedAt",
    ];

    const rows = paginate(async (offset, limit) => {
      return db.select().from(schema.clients)
        .where(forTenant(schema.clients))
        .orderBy(asc(schema.clients.id))
        .limit(limit)
        .offset(offset);
    });

    async function* mapped() {
      for await (const cl of rows) {
        yield [
          cl.id,
          cl.name ?? "",
          cl.phone ?? "",
          cl.email ?? "",
          cl.source ?? "",
          cl.loyaltyCard ?? "",
          cl.discountPercent ?? 0,
          cl.notes ?? "",
          csvBool(cl.isDemo),
          csvDate(cl.createdAt),
          csvDate(cl.updatedAt),
        ];
      }
    }

    return streamCsv(c, "clients.csv", headers, mapped());
  })

  .get("/work-orders.csv", async (c) => {
    const headers = [
      "id", "title", "status", "clientId", "vin", "vehicleMake", "vehicleModel",
      "vehiclePlate", "amount", "partsCost", "laborCost", "mileage",
      "assignedTo", "createdAt", "updatedAt",
    ];

    const rows = paginate(async (offset, limit) => {
      return db.select().from(schema.deals)
        .where(and(forTenant(schema.deals), eq(schema.deals.orderType, "service")))
        .orderBy(asc(schema.deals.id))
        .limit(limit)
        .offset(offset);
    });

    async function* mapped() {
      for await (const d of rows) {
        yield [
          d.id,
          d.title ?? "",
          d.status ?? "",
          d.clientId,
          d.vin ?? "",
          d.vehicleMake ?? "",
          d.vehicleModel ?? "",
          d.vehiclePlate ?? "",
          d.amount ?? "",
          d.partsCost ?? "",
          d.laborCost ?? "",
          d.mileage ?? "",
          d.assignedTo ?? "",
          csvDate(d.createdAt),
          csvDate(d.updatedAt),
        ];
      }
    }

    return streamCsv(c, "work-orders.csv", headers, mapped());
  })

  .get("/stock.csv", async (c) => {
    const headers = [
      "id", "article", "brand", "name", "category", "qty", "price",
      "location", "barcode", "minQty", "isDemo", "createdAt", "updatedAt",
    ];

    const rows = paginate(async (offset, limit) => {
      return db.select().from(schema.partsStock)
        .where(forTenant(schema.partsStock))
        .orderBy(asc(schema.partsStock.id))
        .limit(limit)
        .offset(offset);
    });

    async function* mapped() {
      for await (const p of rows) {
        yield [
          p.id,
          p.article ?? "",
          p.brand ?? "",
          p.name ?? "",
          p.category ?? "",
          p.qty ?? 0,
          p.price ?? "",
          p.location ?? "",
          p.barcode ?? "",
          p.minQty ?? "",
          csvBool(p.isDemo),
          csvDate(p.createdAt),
          csvDate(p.updatedAt),
        ];
      }
    }

    return streamCsv(c, "stock.csv", headers, mapped());
  });
