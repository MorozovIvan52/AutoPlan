import { STO_LABOR_CATALOG_FULL } from "./sto-labor-catalog-data";
import { sqlAll, tableColumns } from "../database/raw-sql";
import { tenantId } from "./tenant-query";

export type StoLaborCatalogItem = {
  code: string;
  name: string;
  normHours: number;
  category: string;
};

/** Полный каталог работ СТО (~200 позиций) */
export const STO_LABOR_CATALOG: StoLaborCatalogItem[] = STO_LABOR_CATALOG_FULL;

const SEARCH_LIMIT_EMPTY = 200;
const SEARCH_LIMIT_QUERY = 80;

async function catalogHasTenantColumn(): Promise<boolean> {
  try {
    const cols = await tableColumns("sto_labor_catalog");
    return cols.some((c) => c.name === "tenant_id");
  } catch {
    return false;
  }
}

export async function searchLaborCatalogFromDb(q: string): Promise<StoLaborCatalogItem[]> {
  try {
    const s = q.trim().toLowerCase();
    const hasTenant = await catalogHasTenantColumn();
    const tid = tenantId();

    if (!s) {
      const rows = hasTenant
        ? await sqlAll<StoLaborCatalogItem>(`
            SELECT code, name, norm_hours as normHours, category FROM sto_labor_catalog
            WHERE is_active = 1 AND tenant_id = ?
            ORDER BY category, sort_order, name LIMIT ?
          `, tid, SEARCH_LIMIT_EMPTY)
        : await sqlAll<StoLaborCatalogItem>(`
            SELECT code, name, norm_hours as normHours, category FROM sto_labor_catalog
            WHERE is_active = 1 ORDER BY category, sort_order, name LIMIT ?
          `, SEARCH_LIMIT_EMPTY);
      if (rows.length) return rows;
    } else {
      const like = `%${s}%`;
      const rows = hasTenant
        ? await sqlAll<StoLaborCatalogItem>(`
            SELECT code, name, norm_hours as normHours, category FROM sto_labor_catalog
            WHERE is_active = 1 AND tenant_id = ?
              AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(category) LIKE ?)
            ORDER BY category, sort_order, name LIMIT ?
          `, tid, like, like, like, SEARCH_LIMIT_QUERY)
        : await sqlAll<StoLaborCatalogItem>(`
            SELECT code, name, norm_hours as normHours, category FROM sto_labor_catalog
            WHERE is_active = 1
              AND (LOWER(name) LIKE ? OR LOWER(code) LIKE ? OR LOWER(category) LIKE ?)
            ORDER BY category, sort_order, name LIMIT ?
          `, like, like, like, SEARCH_LIMIT_QUERY);
      if (rows.length) return rows;
    }
  } catch {
    /* table may not exist yet */
  }
  return searchLaborCatalogStatic(q);
}

function searchLaborCatalogStatic(q: string): StoLaborCatalogItem[] {
  const s = q.trim().toLowerCase();
  if (!s) return STO_LABOR_CATALOG.slice(0, SEARCH_LIMIT_EMPTY);
  return STO_LABOR_CATALOG.filter((i) =>
    i.name.toLowerCase().includes(s)
    || i.code.toLowerCase().includes(s)
    || i.category.toLowerCase().includes(s),
  ).slice(0, SEARCH_LIMIT_QUERY);
}

export async function searchLaborCatalog(q: string): Promise<StoLaborCatalogItem[]> {
  return searchLaborCatalogFromDb(q);
}

export function getLaborCatalogCategories(): string[] {
  const set = new Set(STO_LABOR_CATALOG.map((i) => i.category));
  return Array.from(set).sort();
}
