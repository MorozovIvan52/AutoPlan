import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { sqlGet, sqlRun, sqlExec, tableColumns, tableExists, usePostgres } from "../database/raw-sql";
import { STO_LABOR_CATALOG } from "./sto-labor-catalog";

async function hasColumn(table: string, column: string): Promise<boolean> {
  const rows = await tableColumns(table);
  return rows.some((r) => r.name === column);
}

export async function ensureStoExtendedTables() {
  if (usePostgres()) return;
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS sto_labor_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      norm_hours REAL DEFAULT 1,
      category TEXT,
      hourly_rate REAL,
      is_active INTEGER DEFAULT 1,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS sto_labor_complexes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      is_active INTEGER DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS sto_labor_complex_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      complex_id INTEGER NOT NULL REFERENCES sto_labor_complexes(id) ON DELETE CASCADE,
      catalog_code TEXT,
      name TEXT NOT NULL,
      norm_hours REAL DEFAULT 1,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS deal_diagnostic_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
      group_name TEXT,
      label TEXT NOT NULL,
      status TEXT DEFAULT 'ok',
      note TEXT,
      sort_order INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS deal_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      user_id INTEGER,
      action TEXT NOT NULL,
      detail TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS deal_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deal_id INTEGER NOT NULL,
      user_id INTEGER,
      text TEXT NOT NULL,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS stock_receipts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_number TEXT,
      supplier TEXT,
      status TEXT DEFAULT 'draft',
      total_amount REAL,
      notes TEXT,
      posted_at INTEGER,
      created_by INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS stock_receipt_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_id INTEGER NOT NULL REFERENCES stock_receipts(id) ON DELETE CASCADE,
      stock_part_id INTEGER,
      article TEXT,
      brand TEXT,
      name TEXT NOT NULL,
      qty INTEGER DEFAULT 1,
      purchase_price REAL,
      sale_price REAL
    );
    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      part_id INTEGER NOT NULL,
      qty_delta INTEGER NOT NULL,
      balance_after INTEGER,
      reason TEXT,
      ref_type TEXT,
      ref_id INTEGER,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS client_advances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      balance REAL NOT NULL,
      payment_method TEXT,
      notes TEXT,
      created_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS advance_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      advance_id INTEGER NOT NULL,
      deal_id INTEGER,
      sales_doc_id INTEGER,
      amount REAL NOT NULL,
      created_at INTEGER
    );
  `);

  for (const col of [
    "labor_item_id INTEGER",
    "embedded_in_labor INTEGER DEFAULT 0",
    "reserved_qty INTEGER DEFAULT 0",
    "stock_part_id INTEGER",
  ]) {
    const name = col.split(" ")[0];
    if (!(await hasColumn("order_items", name))) {
      await sqlExec(`ALTER TABLE order_items ADD COLUMN ${col}`);
    }
  }

  if (!(await hasColumn("deal_labor_items", "approval_status"))) {
    await sqlExec("ALTER TABLE deal_labor_items ADD COLUMN approval_status TEXT DEFAULT 'approved'");
  }
  if (!(await hasColumn("deals", "client_approval_status"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN client_approval_status TEXT");
  }

  for (const col of [
    "purchase_price REAL",
    "reserved_qty INTEGER DEFAULT 0",
    "markup_percent REAL",
    "unit TEXT DEFAULT 'шт'",
    "country TEXT",
    "oem_articles TEXT",
  ]) {
    const name = col.split(" ")[0];
    if (!(await hasColumn("parts_stock", name))) {
      await sqlExec(`ALTER TABLE parts_stock ADD COLUMN ${col}`);
    }
  }

  await sqlExec(`
    CREATE TABLE IF NOT EXISTS parts_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id INTEGER NOT NULL DEFAULT 1,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at INTEGER
    )
  `);

  if (!(await hasColumn("crm_settings", "default_markup_percent"))) {
    await sqlExec("ALTER TABLE crm_settings ADD COLUMN default_markup_percent REAL DEFAULT 30");
  }
  if (!(await hasColumn("users", "can_view_money"))) {
    await sqlExec("ALTER TABLE users ADD COLUMN can_view_money INTEGER DEFAULT 1");
  }
  if (!(await hasColumn("users", "can_edit_prices"))) {
    await sqlExec("ALTER TABLE users ADD COLUMN can_edit_prices INTEGER DEFAULT 1");
  }

  if (!(await hasColumn("deals", "defect_photos"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN defect_photos TEXT");
  }
  if (!(await hasColumn("deals", "payment_status"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN payment_status TEXT DEFAULT 'unpaid'");
  }
  if (!(await hasColumn("deals", "paid_amount"))) {
    await sqlExec("ALTER TABLE deals ADD COLUMN paid_amount REAL DEFAULT 0");
  }

  await sqlExec("CREATE INDEX IF NOT EXISTS idx_deals_tenant_payment ON deals(tenant_id, payment_status, status)");
  await sqlExec("CREATE INDEX IF NOT EXISTS idx_deals_tenant_enterprise_updated ON deals(tenant_id, wo_enterprise_id, updated_at)");
  await sqlExec("CREATE INDEX IF NOT EXISTS idx_sales_docs_deal ON sales_documents(deal_id)");

  if (!(await tableExists("deal_work_sessions"))) {
    await sqlExec(`
      CREATE TABLE IF NOT EXISTS deal_work_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        deal_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        created_at INTEGER
      )
    `);
  }

  for (const col of [
    "vin_decodes_used INTEGER DEFAULT 0",
    "stock_skus_active INTEGER DEFAULT 0",
    "call_minutes_used INTEGER DEFAULT 0",
  ]) {
    const name = col.split(" ")[0];
    if (await tableExists("tenant_usage") && !(await hasColumn("tenant_usage", name))) {
      await sqlExec(`ALTER TABLE tenant_usage ADD COLUMN ${col}`);
    }
  }

  await seedLaborCatalog();
  await seedLaborComplexesIfEmpty();
}

async function seedLaborCatalog() {
  if (!(await tableExists("sto_labor_catalog"))) return;
  const hasTenant = await hasColumn("sto_labor_catalog", "tenant_id");
  const now = Date.now();
  const tid = 1;
  for (const [idx, item] of STO_LABOR_CATALOG.entries()) {
    if (hasTenant) {
      await sqlRun(`
        INSERT INTO sto_labor_catalog (tenant_id, code, name, norm_hours, category, is_active, sort_order, created_at)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name = excluded.name,
          norm_hours = excluded.norm_hours,
          category = excluded.category,
          is_active = 1
      `, tid, item.code, item.name, item.normHours, item.category, idx, now);
    } else {
      await sqlRun(`
        INSERT INTO sto_labor_catalog (code, name, norm_hours, category, is_active, sort_order, created_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(code) DO UPDATE SET
          name = excluded.name,
          norm_hours = excluded.norm_hours,
          category = excluded.category,
          is_active = 1
      `, item.code, item.name, item.normHours, item.category, idx, now);
    }
  }
}

async function seedLaborComplexesIfEmpty() {
  const count = await sqlGet<{ c: number }>("SELECT COUNT(*) as c FROM sto_labor_complexes");
  if ((count?.c ?? 0) > 0) return;
  const complexes: { code: string; name: string; category: string; items: { code?: string; name: string; hours: number }[] }[] = [
    {
      code: "CX-TO1",
      name: "ТО-1 комплекс",
      category: "ТО",
      items: [
        { code: "TO-100", name: "ТО-1 (масло + фильтр)", hours: 1.0 },
        { code: "DIAG", name: "Компьютерная диагностика", hours: 0.8 },
      ],
    },
    {
      code: "CX-TO2",
      name: "ТО-2 комплекс",
      category: "ТО",
      items: [
        { code: "TO-200", name: "ТО-2", hours: 2.5 },
        { code: "TO-BRK-FL", name: "Тормозная жидкость", hours: 0.8 },
      ],
    },
    {
      code: "CX-BRK-F",
      name: "Передние тормоза",
      category: "Тормоза",
      items: [
        { code: "BRK-PAD-F", name: "Замена передних колодок", hours: 1.0 },
        { code: "BRK-DISC-PAD-F", name: "Диски + колодки перед", hours: 1.8 },
      ],
    },
    {
      code: "CX-BRK-R",
      name: "Задние тормоза",
      category: "Тормоза",
      items: [
        { code: "BRK-PAD-R", name: "Замена задних колодок", hours: 1.2 },
        { code: "BRK-BLEED", name: "Прокачка тормозов", hours: 0.8 },
      ],
    },
    {
      code: "CX-SUSP-F",
      name: "Передняя подвеска",
      category: "Подвеска",
      items: [
        { code: "SUSP-BALL", name: "Шаровая опора", hours: 1.5 },
        { code: "SUSP-LINK", name: "Стойка стабилизатора", hours: 0.6 },
        { code: "WHEEL-ALIGN", name: "Развал-схождение", hours: 1.0 },
      ],
    },
    {
      code: "CX-TIRE",
      name: "Сезонная переобувка",
      category: "Шиномонтаж",
      items: [
        { code: "TIRE-SEASON", name: "Переобувка 4 колёс", hours: 1.0 },
        { code: "TIRE-BAL-4", name: "Балансировка", hours: 0.8 },
      ],
    },
    {
      code: "CX-AC",
      name: "Кондиционер",
      category: "Климат",
      items: [
        { code: "AC-FILL", name: "Заправка", hours: 1.0 },
        { code: "AC-DISINF", name: "Антибактериальная обработка", hours: 0.5 },
      ],
    },
    {
      code: "CX-GRM",
      name: "Ремень ГРМ",
      category: "Двигатель",
      items: [
        { code: "ENG-BELT-K", name: "Ремень ГРМ + ролики + помпа", hours: 5.5 },
      ],
    },
  ];

  for (const cx of complexes) {
    const r = await sqlRun(
      "INSERT INTO sto_labor_complexes (code, name, category, is_active) VALUES (?, ?, ?, 1)",
      cx.code, cx.name, cx.category,
    );
    const complexId = r.lastInsertRowid;
    for (const [idx, item] of cx.items.entries()) {
      await sqlRun(`
        INSERT INTO sto_labor_complex_items (complex_id, catalog_code, name, norm_hours, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `, complexId, item.code || null, item.name, item.hours, idx);
    }
  }
}

export const DEFAULT_DIAGNOSTIC_CHECKLIST: { group: string; items: string[] }[] = [
  {
    group: "Двигатель",
    items: ["Уровень масла", "Подтёки масла", "Работа на холостом ходу", "Стуки / вибрации"],
  },
  {
    group: "Тормоза",
    items: ["Толщина колодок", "Состояние дисков", "Тормозная жидкость", "Ручной тормоз"],
  },
  {
    group: "Подвеска",
    items: ["Шаровые опоры", "Сайлентблоки", "Амортизаторы", "Пыльники"],
  },
  {
    group: "Рулевое",
    items: ["Люфт руля", "Рулевые наконечники", "Рулевые тяги", "ГУР / ЭУР"],
  },
  {
    group: "Электрика",
    items: ["АКБ", "Генератор", "Стартер", "Ошибки на панели"],
  },
  {
    group: "Кузов / салон",
    items: ["Стёкла", "Фары", "Ремни безопасности", "Климат"],
  },
];
