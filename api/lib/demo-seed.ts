import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { DEMO_USER_EMAIL, DEMO_USER_NAME, invalidateDemoClientCache } from "./demo-mode";
import { recalcDealTotals } from "./deal-totals";
import { DEFAULT_TENANT_ID } from "./tenant-bootstrap";
import { sqlGet } from "../database/raw-sql";

const DEMO_PASSWORD = "Demo2026!";

export async function ensureDemoAccountAndData(): Promise<{ userId: number; created: boolean }> {
  const [existing] = await db.select().from(schema.users).where(eq(schema.users.email, DEMO_USER_EMAIL));
  let userId: number;
  let created = false;

  if (existing) {
    userId = existing.id;
    if (existing.role !== "demo") {
      await db.update(schema.users).set({ role: "demo" as "operator" }).where(eq(schema.users.id, userId));
    }
  } else {
    const [user] = await db.insert(schema.users).values({
      name: DEMO_USER_NAME,
      email: DEMO_USER_EMAIL,
      passwordHash: await hashPassword(DEMO_PASSWORD),
      role: "demo",
      isActive: true,
      tenantId: DEFAULT_TENANT_ID,
    }).returning();
    userId = user.id;
    created = true;
  }

  const demoClients = await sqlGet<{ c: number }>("SELECT COUNT(*) as c FROM clients WHERE is_demo = 1");
  if ((demoClients?.c ?? 0) === 0) {
    await seedDemoData(userId);
    created = true;
  }

  invalidateDemoClientCache();
  return { userId, created };
}

async function seedDemoData(demoUserId: number) {
  const tid = DEFAULT_TENANT_ID;
  const now = Date.now();
  const day = (offset: number) => now - offset * 3600000;

  const clientsData = [
    { name: "Иван Петров", phone: "+79001234567", source: "avito", notes: "Запчасти на Toyota Camry" },
    { name: "Мария Соколова", phone: "+79007654321", source: "whatsapp", notes: "ТО и диагностика" },
    { name: "Алексей Кузнецов", phone: "+79003112233", source: "avito", notes: "Замена тормозных колодок" },
    { name: "Елена Волкова", phone: "+79009876543", source: "telegram", notes: "Заказ-наряд, развал-схождение" },
  ];

  const clientIds: number[] = [];
  for (const cl of clientsData) {
    const [row] = await db.insert(schema.clients).values({
      name: cl.name,
      phone: cl.phone,
      source: cl.source,
      notes: cl.notes,
      preferredMessenger: cl.source === "whatsapp" ? "whatsapp" : cl.source === "telegram" ? "telegram" : "avito",
      isDemo: true,
      tenantId: tid,
    }).returning();
    clientIds.push(row.id);
  }

  const vehicles = [
    { clientId: clientIds[0], make: "Toyota", model: "Camry", year: 2018, plate: "А123ВС777", vin: "JTDBR32E123456789", mileage: 87000 },
    { clientId: clientIds[1], make: "Hyundai", model: "Solaris", year: 2020, plate: "В456ОР777", vin: "Z94CB41A123456789", mileage: 45000 },
    { clientId: clientIds[2], make: "Volkswagen", model: "Polo", year: 2019, plate: "С789ТТ777", mileage: 62000 },
    { clientId: clientIds[3], make: "Kia", model: "Rio", year: 2021, plate: "Е111КХ777", mileage: 28000 },
  ];
  for (const v of vehicles) {
    await db.insert(schema.vehicles).values(v);
  }

  const convSpecs = [
    { clientId: clientIds[0], channelType: "avito", lastMessageText: "Здравствуйте! Есть колодки на Camry 2018?", unread: 2 },
    { clientId: clientIds[1], channelType: "whatsapp", lastMessageText: "Когда можно записаться на ТО?", unread: 0 },
    { clientId: clientIds[2], channelType: "avito", lastMessageText: "Сколько стоит замена передних колодок?", unread: 1 },
    { clientId: clientIds[3], channelType: "telegram", lastMessageText: "Спасибо, жду расчёт по ЗН", unread: 0 },
  ];

  const messageTemplates: { senderType: "client" | "operator"; text: string }[][] = [
    [
      { senderType: "client", text: "Здравствуйте! Есть колодки на Camry 2018?" },
      { senderType: "operator", text: "Добрый день! Да, есть Ferodo и Bosch. Какие предпочитаете?" },
      { senderType: "client", text: "Ferodo, оригинал не нужен. С доставкой можно?" },
      { senderType: "operator", text: "Ferodo FDB1234 — 4200 ₽, в наличии. СДЭК или самовывоз с ул. Примерная, 5." },
    ],
    [
      { senderType: "client", text: "Добрый день! Хочу записаться на ТО-1" },
      { senderType: "operator", text: "Здравствуйте! Свободно завтра с 10:00 или послезавтра с 14:00." },
      { senderType: "client", text: "Завтра в 10 подойдёт. Solaris 2020, 45 тыс км" },
      { senderType: "operator", text: "Записала. Адрес: ул. Примерная, 5. Ждём вас!" },
    ],
    [
      { senderType: "client", text: "Сколько стоит замена передних колодок Polo?" },
      { senderType: "operator", text: "Работа 2500 ₽ + колодки от 2800 ₽. Можем сегодня до 18:00." },
    ],
    [
      { senderType: "client", text: "Приехала на развал после замены рычагов" },
      { senderType: "operator", text: "ЗН-102 готов, итого 8500 ₽. Можете забирать после 17:00." },
      { senderType: "client", text: "Спасибо, жду расчёт по ЗН" },
    ],
  ];

  for (let i = 0; i < convSpecs.length; i++) {
    const spec = convSpecs[i];
    const [conv] = await db.insert(schema.conversations).values({
      clientId: spec.clientId,
      channelType: spec.channelType,
      status: "open",
      assignedTo: demoUserId,
      lastMessageAt: new Date(day(i)),
      lastMessageText: spec.lastMessageText,
      lastMessageSenderType: "client",
      unreadCount: spec.unread,
      tenantId: tid,
    }).returning();

    for (let j = 0; j < messageTemplates[i].length; j++) {
      const msg = messageTemplates[i][j];
      await db.insert(schema.messages).values({
        conversationId: conv.id,
        senderType: msg.senderType,
        senderId: msg.senderType === "operator" ? demoUserId : null,
        text: msg.text,
        createdAt: new Date(day(i) - (messageTemplates[i].length - j) * 600000),
      });
    }
  }

  const [deal1] = await db.insert(schema.deals).values({
    clientId: clientIds[0],
    title: "Колодки Ferodo Camry",
    orderType: "parts",
    status: "quoted",
    amount: 4200,
    description: "Ferodo FDB1234 передние",
    vehicleMake: "Toyota",
    vehicleModel: "Camry",
    vehicleYear: 2018,
    vehiclePlate: "А123ВС777",
    assignedTo: demoUserId,
    tenantId: tid,
  }).returning();

  await db.insert(schema.orderItems).values({
    dealId: deal1.id,
    article: "FDB1234",
    brand: "Ferodo",
    name: "Колодки тормозные передние",
    qty: 1,
    price: 4200,
    partSource: "stock",
  });

  const [deal2] = await db.insert(schema.deals).values({
    clientId: clientIds[3],
    title: "Развал-схождение + рычаги",
    orderType: "service",
    status: "in_progress",
    amount: 8500,
    laborCost: 5500,
    partsCost: 3000,
    vehicleMake: "Kia",
    vehicleModel: "Rio",
    vehicleYear: 2021,
    vehiclePlate: "Е111КХ777",
    mileage: 28000,
    woEnterpriseId: null,
    assignedTo: demoUserId,
    tenantId: tid,
  }).returning();

  await db.insert(schema.dealLaborItems).values([
    { dealId: deal2.id, name: "Замена рычагов (пара)", normHours: 2.5, hours: 2.5, hourlyRate: 2500, price: 6250, sortOrder: 0 },
    { dealId: deal2.id, name: "Развал-схождение", normHours: 1, hours: 1, hourlyRate: 2500, price: 2500, sortOrder: 1 },
  ]);
  await db.insert(schema.orderItems).values({
    dealId: deal2.id,
    article: "SB-4521",
    brand: "Febi",
    name: "Сайлентблок рычага",
    qty: 2,
    price: 1500,
    partSource: "stock",
  });
  await recalcDealTotals(deal2.id);

  const [deal3] = await db.insert(schema.deals).values({
    clientId: clientIds[1],
    title: "ТО-1 Hyundai Solaris",
    orderType: "service",
    status: "new",
    amount: 6500,
    vehicleMake: "Hyundai",
    vehicleModel: "Solaris",
    vehicleYear: 2020,
    vehiclePlate: "В456ОР777",
    mileage: 45000,
    assignedTo: demoUserId,
    tenantId: tid,
  }).returning();
  await db.insert(schema.dealLaborItems).values({
    dealId: deal3.id,
    code: "TO-100",
    name: "ТО-1 (масло + фильтры)",
    normHours: 1.2,
    hours: 1.2,
    hourlyRate: 2500,
    price: 3000,
    sortOrder: 0,
  });
  await recalcDealTotals(deal3.id);

  const parts = [
    { article: "DEMO-OIL5W30", brand: "Castrol", name: "Масло моторное 5W-30 4л", qty: 12, price: 3200, category: "Масла" },
    { article: "DEMO-FILTER-OIL", brand: "Mann", name: "Фильтр масляный W712/95", qty: 8, price: 650, category: "Фильтры" },
    { article: "DEMO-PAD-F", brand: "Ferodo", name: "Колодки передние универсальные", qty: 4, price: 2800, category: "Тормоза" },
    { article: "DEMO-WIPER", brand: "Bosch", name: "Щётки стеклоочистителя 650/400", qty: 6, price: 1200, category: "Аксессуары" },
  ];
  for (const p of parts) {
    await db.insert(schema.partsStock).values({
      article: p.article,
      brand: p.brand,
      name: p.name,
      qty: p.qty,
      price: p.price,
      category: p.category,
      minQty: 2,
      isDemo: true,
      tenantId: tid,
    }).returning();
  }

  await db.insert(schema.tasks).values([
    { title: "Перезвонить Ивану по колодкам", status: "todo", priority: "high", assignedTo: demoUserId, clientId: clientIds[0], dueAt: new Date(now + 86400000), tenantId: tid },
    { title: "Подготовить ЗН для Solaris", status: "todo", priority: "medium", assignedTo: demoUserId, clientId: clientIds[1], dueAt: new Date(now + 172800000), tenantId: tid },
  ]);

  await db.insert(schema.serviceAppointments).values({
    clientId: clientIds[1],
    title: "ТО-1 Hyundai Solaris",
    scheduledAt: new Date(now + 86400000),
    durationMin: 90,
    status: "scheduled",
    plate: "В456ОР777",
    make: "Hyundai",
    model: "Solaris",
    tenantId: tid,
    mileage: 45000,
    phone: "+79007654321",
  });

  void demoUserId;
}

export function isDemoEnabled(): boolean {
  const v = process.env.DEMO_ENABLED?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no") return false;
  return true;
}
