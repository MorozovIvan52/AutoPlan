import { db } from "../database";
import * as schema from "../database/schema";
import { eq, desc, and } from "drizzle-orm";
import { phonesMatch } from "./phone-normalize";
import { normalizePlate, platesMatch } from "./plate-normalize";
import { forTenant } from "./tenant-query";

export type CatalogVehicle = {
  id: number | string;
  clientId: number;
  clientName: string;
  clientPhone: string | null;
  vin: string | null;
  plate: string | null;
  make: string | null;
  model: string | null;
  year: number | null;
  mileage: number | null;
  source: "garage" | "deal";
  dealId?: number;
};

export async function buildVehicleCatalog(): Promise<CatalogVehicle[]> {
  const rows = await db
    .select({ vehicle: schema.vehicles, client: schema.clients })
    .from(schema.vehicles)
    .innerJoin(schema.clients, eq(schema.vehicles.clientId, schema.clients.id))
    .where(forTenant(schema.clients))
    .orderBy(desc(schema.vehicles.id));

  const list: CatalogVehicle[] = rows.map(({ vehicle, client }) => ({
    id: vehicle.id,
    clientId: client.id,
    clientName: client.name,
    clientPhone: client.phone,
    vin: vehicle.vin,
    plate: vehicle.plate,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year,
    mileage: vehicle.mileage,
    source: "garage",
  }));

  const garageIds = new Set(rows.map((r) => r.vehicle.id));
  const seenKeys = new Set(
    list.map((v) => `${(v.vin || "").toLowerCase()}|${normalizePlate(v.plate)}|${v.clientId}`),
  );

  const dealRows = await db
    .select({ deal: schema.deals, client: schema.clients })
    .from(schema.deals)
    .innerJoin(schema.clients, eq(schema.deals.clientId, schema.clients.id))
    .where(and(forTenant(schema.deals), eq(schema.deals.orderType, "service")))
    .orderBy(desc(schema.deals.updatedAt));

  for (const { deal, client } of dealRows) {
    if (deal.vehicleId && garageIds.has(deal.vehicleId)) continue;
    const hasCar = deal.vehicleMake || deal.vehicleModel || deal.vin || deal.vehiclePlate;
    if (!hasCar) continue;
    const key = `${(deal.vin || "").toLowerCase()}|${normalizePlate(deal.vehiclePlate)}|${client.id}`;
    if (key !== "||" && seenKeys.has(key)) continue;
    if (key !== "||") seenKeys.add(key);
    list.push({
      id: `deal-${deal.id}`,
      clientId: client.id,
      clientName: client.name,
      clientPhone: client.phone,
      vin: deal.vin,
      plate: deal.vehiclePlate,
      make: deal.vehicleMake,
      model: deal.vehicleModel,
      year: deal.vehicleYear,
      mileage: deal.mileage,
      source: "deal",
      dealId: deal.id,
    });
  }

  return list;
}

export function filterCatalog(
  list: CatalogVehicle[],
  opts: { q?: string; clientId?: number | null; plate?: string },
): CatalogVehicle[] {
  let filtered = list;
  if (opts.clientId && !Number.isNaN(opts.clientId)) {
    filtered = filtered.filter((v) => v.clientId === opts.clientId);
  }

  const plateNorm = opts.plate ? normalizePlate(opts.plate) : "";
  if (plateNorm.length >= 4) {
    const exact = filtered.filter((v) => platesMatch(v.plate, plateNorm));
    if (exact.length) return exact;
    return filtered.filter((v) => {
      const vp = normalizePlate(v.plate);
      return vp && (vp.includes(plateNorm) || plateNorm.includes(vp));
    });
  }

  const qRaw = (opts.q || "").trim();
  const q = qRaw.toLowerCase();
  if (!q) return filtered;

  const qDigits = qRaw.replace(/\D/g, "");
  const qPlate = normalizePlate(qRaw);

  return filtered.filter((v) => {
    if (qPlate.length >= 4 && platesMatch(v.plate, qPlate)) return true;
    const blob = [
      v.make, v.model, v.plate, v.vin, v.clientName, v.clientPhone,
      String(v.year), v.mileage != null ? String(v.mileage) : "",
    ].filter(Boolean).join(" ").toLowerCase();
    if (blob.includes(q)) return true;
    if (v.clientPhone && phonesMatch(v.clientPhone, qRaw)) return true;
    if (qDigits.length >= 4 && v.clientPhone && phonesMatch(v.clientPhone, qDigits)) return true;
    return false;
  });
}

export function sortByPlatePriority(list: CatalogVehicle[], plate: string): CatalogVehicle[] {
  const norm = normalizePlate(plate);
  if (!norm) return list;
  return [...list].sort((a, b) => {
    const ea = platesMatch(a.plate, norm) ? 0 : 1;
    const eb = platesMatch(b.plate, norm) ? 0 : 1;
    return ea - eb;
  });
}

export async function findByPlate(plateRaw: string): Promise<{
  normalizedPlate: string;
  exact: boolean;
  vehicles: CatalogVehicle[];
  client: { id: number; name: string; phone: string | null } | null;
}> {
  const normalizedPlate = normalizePlate(plateRaw);
  if (normalizedPlate.length < 4) {
    return { normalizedPlate, exact: false, vehicles: [], client: null };
  }

  const all = await buildVehicleCatalog();
  const exactMatches = all.filter((v) => platesMatch(v.plate, normalizedPlate));
  const vehicles = exactMatches.length
    ? exactMatches
    : all.filter((v) => {
      const vp = normalizePlate(v.plate);
      return vp.length >= 4 && (vp.includes(normalizedPlate) || normalizedPlate.includes(vp));
    });

  const primary = vehicles[0];
  const client = primary
    ? { id: primary.clientId, name: primary.clientName, phone: primary.clientPhone }
    : null;

  return {
    normalizedPlate,
    exact: exactMatches.length > 0,
    vehicles,
    client,
  };
}
