/**
 * Демо-полигон: 3 пилотных СТО (tenant sto-1, sto-2, sto-3).
 *
 * Запуск:
 *   npm run pilot:seed
 *   npm run pilot:seed:clean    # удалить старые sto-1/2/3 и создать заново
 *
 * Пароль всех demo-пользователей: PilotDemo2026!
 * (scrypt через hashPassword — не bcrypt)
 */
import "../load-env.ts";
import { db, closeDatabase, usePostgres } from "../api/database/index.ts";
import * as schema from "../api/database/schema.ts";
import { hashPassword } from "../api/lib/password.ts";
import { runWithTenant } from "../api/lib/tenant-context.ts";
import { recalcDealTotals } from "../api/lib/deal-totals.ts";
import { eq } from "drizzle-orm";
import { ensureAllDbBootstrap } from "../api/lib/db-bootstrap.ts";
import { sqlAll, sqlGet, sqlRun, tableExists } from "../api/database/raw-sql.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { getOfferVersion } from "../api/lib/license-offer-text.ts";

const DEMO_PASSWORD = "PilotDemo2026!";
const PILOT_SLUGS = ["sto-1", "sto-2", "sto-3"] as const;

type PilotManifest = {
  password: string;
  tenants: Array<{
    slug: string;
    id: number;
    subdomain: string;
    users: Array<{ role: string; email: string; id: number }>;
    clientId: number;
    conversationId: number;
    deals: { closedId: number; draftId: number };
    racePartId: number;
    racePartArticle: string;
    receiptDocId: number | null;
  }>;
};

const args = new Set(process.argv.slice(2));
const CLEAN = args.has("--clean");

async function findPilotTenant(slug: string): Promise<{ id: number; slug: string } | undefined> {
  return sqlGet<{ id: number; slug: string }>(
    "SELECT id, slug FROM tenants WHERE slug = ?",
    slug,
  );
}

async function insertPilotTenant(opts: {
  slug: string;
  name: string;
  subdomain: string;
  trialEnds: Date;
}): Promise<number> {
  const r = await sqlRun(
    `INSERT INTO tenants (slug, name, subdomain, subscription_status, subscription_plan, trial_ends_at, max_users, is_active, created_at)
     VALUES (?, ?, ?, 'trial', 'business', ?, 10, 1, ?)`,
    opts.slug,
    opts.name,
    opts.subdomain,
    opts.trialEnds.getTime(),
    Date.now(),
  );
  return Number(r.lastInsertRowid);
}

async function insertPilotUser(opts: {
  tenantId: number;
  name: string;
  email: string;
  passwordHash: string;
  role: "admin" | "master" | "operator";
}): Promise<number> {
  const r = await sqlRun(
    `INSERT INTO users (tenant_id, name, email, password_hash, role, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, 1, ?)`,
    opts.tenantId,
    opts.name,
    opts.email,
    opts.passwordHash,
    opts.role,
    Date.now(),
  );
  return Number(r.lastInsertRowid);
}

async function seedPostedReceiptFromDeal(opts: {
  tenantId: number;
  dealId: number;
  adminUserId: number;
  clientId: number;
  companyName: string;
  clientName: string;
  clientPhone: string | null;
  totalAmount: number;
  lines: Array<{ stockPartId?: number; article: string; brand: string; name: string; qty: number; price: number }>;
}): Promise<number> {
  const docNumber = `PILOT-TCH-${opts.dealId}`;
  const [doc] = await db.insert(schema.salesDocuments).values({
    tenantId: opts.tenantId,
    docType: "receipt",
    docNumber,
    status: "posted",
    clientId: opts.clientId,
    dealId: opts.dealId,
    managerId: opts.adminUserId,
    companyName: opts.companyName,
    recipientName: opts.clientName,
    recipientPhone: opts.clientPhone,
    paymentMethod: "cash",
    paymentAmount: opts.totalAmount,
    totalAmount: opts.totalAmount,
    postedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  let sort = 0;
  for (const line of opts.lines) {
    await db.insert(schema.salesDocumentItems).values({
      documentId: doc!.id,
      stockPartId: line.stockPartId ?? null,
      article: line.article,
      brand: line.brand,
      name: line.name,
      qty: line.qty,
      price: line.price,
      sortOrder: sort++,
    });
    if (line.stockPartId) {
      await sqlRun(
        "UPDATE parts_stock SET qty = qty - ? WHERE id = ? AND tenant_id = ?",
        line.qty,
        line.stockPartId,
        opts.tenantId,
      );
    }
  }

  await db.update(schema.deals).set({
    status: "done",
    paymentStatus: "paid",
    paidAmount: opts.totalAmount,
    amount: opts.totalAmount,
    updatedAt: new Date(),
  }).where(eq(schema.deals.id, opts.dealId));

  return doc!.id;
}

async function deletePilotTenant(tenantId: number, tenantSlug: string) {
  await runWithTenant({ tenantId, tenantSlug }, async () => {
    const dealRows = await sqlAll<{ id: number }>(
      "SELECT id FROM deals WHERE tenant_id = ?",
      tenantId,
    );
    const ids = dealRows.map((r) => r.id);

    await sqlRun(
      "DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ?)",
      tenantId,
    );
    await sqlRun("DELETE FROM conversations WHERE tenant_id = ?", tenantId);
    await sqlRun(
      "DELETE FROM sales_document_items WHERE document_id IN (SELECT id FROM sales_documents WHERE tenant_id = ?)",
      tenantId,
    );
    await sqlRun("DELETE FROM sales_documents WHERE tenant_id = ?", tenantId);
    if (await tableExists("stock_movements")) {
      await sqlRun(
        "DELETE FROM stock_movements WHERE part_id IN (SELECT id FROM parts_stock WHERE tenant_id = ?)",
        tenantId,
      );
    }
    if (ids.length) {
      const ph = ids.map(() => "?").join(",");
      await sqlRun(`DELETE FROM order_items WHERE deal_id IN (${ph})`, ...ids);
      if (await tableExists("deal_labor_items")) {
        await sqlRun(`DELETE FROM deal_labor_items WHERE deal_id IN (${ph})`, ...ids);
      }
      for (const tbl of ["deal_notes", "deal_work_sessions", "deal_audit_log", "documents"] as const) {
        if (await tableExists(tbl)) {
          await sqlRun(`DELETE FROM ${tbl} WHERE deal_id IN (${ph})`, ...ids);
        }
      }
    }
    await sqlRun("DELETE FROM deals WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM parts_stock WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM tasks WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM service_appointments WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM clients WHERE tenant_id = ?", tenantId);
    if (await tableExists("sessions")) {
      await sqlRun(
        "DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = ?)",
        tenantId,
      );
    }
    if (await tableExists("license_offer_otps")) {
      await sqlRun("DELETE FROM license_offer_otps WHERE tenant_id = ?", tenantId);
    }
    await sqlRun("DELETE FROM users WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM crm_settings WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM tags WHERE tenant_id = ?", tenantId);
    await sqlRun("DELETE FROM channels WHERE tenant_id = ?", tenantId);
  });

  await sqlRun("DELETE FROM tenants WHERE id = ?", tenantId);
}

async function cleanAllPilotTenants() {
  for (const slug of PILOT_SLUGS) {
    const existing = await findPilotTenant(slug);
    if (existing) {
      console.log(`[pilot] clean tenant ${slug} (id=${existing.id})`);
      await deletePilotTenant(existing.id, slug);
    }
  }
}

async function seedOneTenant(index: 1 | 2 | 3): Promise<PilotManifest["tenants"][0]> {
  const slug = `sto-${index}` as (typeof PILOT_SLUGS)[number];
  const subdomain = `sto${index}`;
  const companyName = `Пилот СТО ${index}`;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const trialEnds = new Date(Date.now() + 30 * 86400000);

  const existing = await findPilotTenant(slug);
  if (existing) {
    throw new Error(`Tenant ${slug} уже существует. Запустите с --clean`);
  }

  const tenantId = await insertPilotTenant({
    slug,
    name: companyName,
    subdomain,
    trialEnds,
  });
  const tenant = { id: tenantId, slug };

  await sqlRun(
    `UPDATE tenants SET offer_accepted_at = ?, offer_version = ?, offer_accepted_phone = ?
     WHERE id = ?`,
    Date.now(),
    getOfferVersion(),
    `+7495${String(1000000 + index)}`,
    tenantId,
  );

  let users: PilotManifest["tenants"][0]["users"] = [];
  let clientId = 0;
  let conversationId = 0;
  let closedDealId = 0;
  let draftDealId = 0;
  let racePartId = 0;
  let raceArticle = "";
  let receiptDocId: number | null = null;

  await runWithTenant({ tenantId: tenant.id, tenantSlug: slug }, async () => {
    const userSpecs = [
      { key: "master", role: "master" as const, name: `Мастер СТО-${index}`, email: `master@sto${index}.demo` },
      { key: "admin", role: "admin" as const, name: `Админ СТО-${index}`, email: `admin@sto${index}.demo` },
      { key: "accountant", role: "operator" as const, name: `Бухгалтер СТО-${index}`, email: `accountant@sto${index}.demo` },
    ];

    for (const u of userSpecs) {
      const uid = await insertPilotUser({
        tenantId: tenant.id,
        name: u.name,
        email: u.email,
        passwordHash,
        role: u.role,
      });
      users.push({ role: u.key, email: u.email, id: uid });
    }

    const adminUser = users.find((u) => u.role === "admin")!;
    const masterUser = users.find((u) => u.role === "master")!;

    await db.insert(schema.tags).values([
      { name: "Пилот", color: "#2563eb", tenantId: tenant.id },
      { name: "СТО", color: "#06b6d4", tenantId: tenant.id },
    ]);

    await db.insert(schema.crmSettings).values({
      tenantId: tenant.id,
      companyName,
      companyPhone: `+7495${String(1000000 + index)}`,
      companyInn: `${7700000000 + index}`,
      receiptShowArticles: true,
      defaultLaborRate: 2500,
    });

    const [client] = await db.insert(schema.clients).values({
      tenantId: tenant.id,
      name: `Клиент пилота ${index}`,
      phone: `+7900${String(1000000 + index)}`,
      source: "avito",
      preferredMessenger: "avito",
      isDemo: true,
    }).returning();
    clientId = client!.id;

    await db.insert(schema.vehicles).values({
      clientId: client!.id,
      make: index === 1 ? "Toyota" : index === 2 ? "Hyundai" : "Kia",
      model: index === 1 ? "Camry" : index === 2 ? "Solaris" : "Rio",
      year: 2018 + index,
      plate: `А${100 + index}ВС777`,
      vin: `PILOTVIN000000000${index}`,
      mileage: 50000 + index * 1000,
    });

    const partSpecs = [
      { article: `PILOT-${index}-001`, name: "Масло 5W-30 4л", qty: 12, price: 3200 },
      { article: `PILOT-${index}-002`, name: "Фильтр масляный", qty: 8, price: 650 },
      { article: `PILOT-${index}-003`, name: "Колодки передние", qty: 6, price: 2800 },
      { article: `PILOT-${index}-004`, name: "Щётки дворников", qty: 10, price: 1200 },
      { article: `PILOT-${index}-RACE`, name: "Датчик ABS (race test)", qty: 1, price: 4500 },
    ];

    const partIds: Record<string, number> = {};
    for (const p of partSpecs) {
      const [part] = await db.insert(schema.partsStock).values({
        tenantId: tenant.id,
        article: p.article,
        brand: "Pilot",
        name: p.name,
        qty: p.qty,
        price: p.price,
        purchasePrice: Math.round(p.price * 0.6),
        category: "Пилот",
        minQty: 1,
        isDemo: true,
      }).returning();
      partIds[p.article] = part!.id;
    }

    raceArticle = `PILOT-${index}-RACE`;
    racePartId = partIds[raceArticle]!;

    const [closedDeal] = await db.insert(schema.deals).values({
      tenantId: tenant.id,
      clientId: client!.id,
      title: `ЗН завершён — ТО пилот ${index}`,
      orderType: "service",
      status: "ready",
      vin: `PILOTVIN000000000${index}`,
      vehicleMake: index === 1 ? "Toyota" : index === 2 ? "Hyundai" : "Kia",
      vehicleModel: index === 1 ? "Camry" : index === 2 ? "Solaris" : "Kia",
      vehiclePlate: `А${100 + index}ВС777`,
      assignedTo: masterUser.id,
    }).returning();
    closedDealId = closedDeal!.id;

    await db.insert(schema.dealLaborItems).values({
      dealId: closedDealId,
      code: "TO-100",
      name: "ТО-1",
      normHours: 1.2,
      hours: 1.2,
      hourlyRate: 2500,
      price: 3000,
      executorUserId: masterUser.id,
      sortOrder: 0,
    });

    await db.insert(schema.orderItems).values({
      dealId: closedDealId,
      article: partSpecs[0]!.article,
      brand: "Pilot",
      name: partSpecs[0]!.name,
      qty: 1,
      price: partSpecs[0]!.price,
      partSource: "stock",
      stockPartId: partIds[partSpecs[0]!.article],
    });

    await recalcDealTotals(closedDealId);

    const totalAmount = 6200;
    receiptDocId = await seedPostedReceiptFromDeal({
      tenantId: tenant.id,
      dealId: closedDealId,
      adminUserId: adminUser.id,
      clientId: client!.id,
      companyName,
      clientName: client!.name,
      clientPhone: client!.phone,
      totalAmount,
      lines: [
        {
          stockPartId: partIds[partSpecs[0]!.article],
          article: partSpecs[0]!.article,
          brand: "Pilot",
          name: partSpecs[0]!.name,
          qty: 1,
          price: partSpecs[0]!.price,
        },
        {
          article: "TO-100",
          brand: "",
          name: "ТО-1",
          qty: 1,
          price: 3000,
        },
      ],
    });

    const [draftDeal] = await db.insert(schema.deals).values({
      tenantId: tenant.id,
      clientId: client!.id,
      title: `ЗН в работе — датчик ABS (остаток 1)`,
      orderType: "service",
      status: "in_progress",
      vin: `PILOTVIN000000000${index}`,
      assignedTo: masterUser.id,
    }).returning();
    draftDealId = draftDeal!.id;

    await db.insert(schema.orderItems).values({
      dealId: draftDealId,
      article: raceArticle,
      brand: "Pilot",
      name: "Датчик ABS (race test)",
      qty: 1,
      price: 4500,
      partSource: "stock",
      stockPartId: racePartId,
    });

    await recalcDealTotals(draftDealId);

    const [conv] = await db.insert(schema.conversations).values({
      tenantId: tenant.id,
      clientId: client!.id,
      channelType: "avito",
      status: "open",
      assignedTo: adminUser.id,
      lastMessageAt: new Date(),
      lastMessageText: "Подтверждаю запись на диагностику по VIN",
      lastMessageSenderType: "operator",
      unreadCount: 0,
    }).returning();
    conversationId = conv!.id;

    const now = Date.now();
    const chatLines: { senderType: "client" | "operator"; senderId: number | null; text: string; offsetMs: number }[] = [
      { senderType: "client", senderId: null, text: `Здравствуйте! Можете проверить авто по VIN PILOTVIN000000000${index}?`, offsetMs: 300000 },
      { senderType: "operator", senderId: adminUser.id, text: "Добрый день! VIN приняли, завели карточку. Можем записать на завтра 10:00.", offsetMs: 240000 },
      { senderType: "client", senderId: null, text: "Да, подходит. Сколько займёт диагностика?", offsetMs: 180000 },
      { senderType: "operator", senderId: masterUser.id, text: "Мастер подтверждает: диагностика ~1 н/ч, ЗН уже в системе.", offsetMs: 120000 },
      { senderType: "client", senderId: null, text: "Отлично, жду.", offsetMs: 60000 },
    ];

    for (const line of chatLines) {
      await db.insert(schema.messages).values({
        conversationId: conv!.id,
        senderType: line.senderType,
        senderId: line.senderId,
        text: line.text,
        createdAt: new Date(now - line.offsetMs),
      });
    }
  });

  return {
    slug,
    id: tenant.id,
    subdomain,
    users,
    clientId,
    conversationId,
    deals: { closedId: closedDealId, draftId: draftDealId },
    racePartId,
    racePartArticle: raceArticle,
    receiptDocId,
  };
}

function printCredentialsTable(manifest: PilotManifest) {
  console.log("\n=== Пилот: логины (пароль для всех) ===");
  console.log(`Пароль: ${manifest.password}\n`);
  console.log("| Tenant | Email | Role | Password |");
  console.log("|--------|-------|------|----------|");
  for (const t of manifest.tenants) {
    for (const u of t.users) {
      console.log(`| ${t.slug} | ${u.email} | ${u.role} | ${manifest.password} |`);
    }
  }
  console.log("\n| Tenant | User ID | closed ZN | in_progress ZN |");
  console.log("|--------|---------|-----------|----------------|");
  for (const t of manifest.tenants) {
    console.log(`| ${t.slug} (id=${t.id}) | см. email выше | ${t.deals.closedId} | ${t.deals.draftId} |`);
  }
  console.log("\n=== Сводка данных ===");
  for (const t of manifest.tenants) {
    console.log(
      `${t.slug}: deals closed=${t.deals.closedId} in_progress=${t.deals.draftId}, ` +
      `race part ${t.racePartArticle} id=${t.racePartId}, conv=${t.conversationId}, receipt=${t.receiptDocId}`,
    );
  }
  if (usePostgres()) {
    console.log("\nPostgres: убедитесь, что RLS включён:");
    console.log("  psql \"$DATABASE_URL\" -f scripts/setup-postgres-rls.pgsql");
    console.log("  export PG_RLS=1");
  } else {
    console.log("\nSQLite: изоляция через app-layer (forTenant). Для 3 СТО на одной БД — мигрируйте на Postgres + RLS.");
  }
  console.log("\nПроверка: npm run pilot:verify");
  console.log("Манифест: scripts/pilot-demo-manifest.json\n");
}

async function main() {
  await ensureAllDbBootstrap();

  if (CLEAN) {
    await cleanAllPilotTenants();
  }

  for (const slug of PILOT_SLUGS) {
    const exists = await findPilotTenant(slug);
    if (exists) {
      console.error(`[pilot] Tenant ${slug} уже есть. Используйте: npm run pilot:seed:clean`);
      process.exit(1);
    }
  }

  const manifest: PilotManifest = {
    password: DEMO_PASSWORD,
    tenants: [],
  };

  for (const n of [1, 2, 3] as const) {
    console.log(`[pilot] seed sto-${n}...`);
    manifest.tenants.push(await seedOneTenant(n));
  }

  const manifestPath = join(process.cwd(), "scripts", "pilot-demo-manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  printCredentialsTable(manifest);
  console.log("[pilot] OK — 3 demo tenants ready");
}

main()
  .catch((e) => {
    console.error("[pilot] FAILED", e);
    process.exit(1);
  })
  .finally(() => closeDatabase());
