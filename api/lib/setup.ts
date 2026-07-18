import { db } from "../database";
import * as schema from "../database/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "./password";
import { DEFAULT_TENANT_ID } from "./tenant-bootstrap";
import { getTenantId } from "./tenant-context";

export async function hasUsers(): Promise<boolean> {
  const rows = await db.select().from(schema.users).limit(1);
  return rows.length > 0;
}

export async function runInitialSetup(opts: {
  email: string;
  password: string;
  name?: string;
  companyName?: string;
}) {
  const email = opts.email.trim().toLowerCase();
  const name = (opts.name || "Администратор").trim();
  const passwordHash = await hashPassword(opts.password);
  const companyName = (opts.companyName || "АвтоПлан").trim();

  return db.transaction(async (tx) => {
    const existing = await tx.select().from(schema.users).limit(1);
    if (existing.length > 0) {
      throw new Error("Система уже настроена");
    }

    const tenantRows = await tx.select().from(schema.tenants).limit(1);
    let tenantId = tenantRows[0]?.id ?? DEFAULT_TENANT_ID;
    if (!tenantRows.length) {
      const [tenant] = await tx.insert(schema.tenants).values({
        id: DEFAULT_TENANT_ID,
        slug: "default",
        name: companyName,
        subdomain: process.env.DEFAULT_TENANT_SUBDOMAIN?.trim() || null,
        subscriptionStatus: "active",
        subscriptionPlan: "business",
        maxUsers: 25,
        isActive: true,
      }).returning();
      tenantId = tenant!.id;
    }

    await tx.insert(schema.users).values({
      name,
      email,
      passwordHash,
      role: "admin",
      tenantId,
    });

    await tx.insert(schema.tags).values([
      { name: "Подбор по VIN", color: "#2563eb", tenantId },
      { name: "Оригинал", color: "#10b981", tenantId },
      { name: "Аналог", color: "#f59e0b", tenantId },
      { name: "В наличии", color: "#22c55e", tenantId },
      { name: "Под заказ", color: "#8b5cf6", tenantId },
      { name: "Доставка", color: "#f97316", tenantId },
      { name: "Срочно", color: "#ef4444", tenantId },
      { name: "СТО", color: "#06b6d4", tenantId },
      { name: "Авито", color: "#00aaff", tenantId },
      { name: "Гарантия", color: "#eab308", tenantId },
      { name: "VIP", color: "#ec4899", tenantId },
      { name: "Опт", color: "#6b7280", tenantId },
    ]);

    await tx.insert(schema.quickTemplates).values([
      { title: "Запрос VIN", text: "Здравствуйте! Для точного подбора запчасти пришлите VIN (17 символов) или марку/модель/год и объём двигателя.", category: "parts", sortOrder: 1, tenantId },
      { title: "В наличии", text: "Запчасть есть в наличии. Можете забрать сегодня или оформим доставку — как удобнее?", category: "parts", sortOrder: 2, tenantId },
      { title: "Оригинал и аналог", text: "Подготовил варианты: оригинал и качественный аналог. Напишите, какой вариант выбираете.", category: "parts", sortOrder: 3, tenantId },
      { title: "Запись на СТО", text: "Можем записать на диагностику/ремонт. Укажите удобную дату и время, а также кратко опишите проблему.", category: "service", sortOrder: 4, tenantId },
      { title: "Статус заказа", text: "Ваш заказ в работе. Ожидаемое время готовности — уточню и сообщу в течение часа.", category: "general", sortOrder: 5, tenantId },
      { title: "Оплата и доставка", text: "Итого к оплате: ___ ₽. Доставка СДЭК/самовывоз. Реквизиты или адрес пункта выдачи отправлю после подтверждения.", category: "parts", sortOrder: 6, tenantId },
    ]);

    await tx.insert(schema.partsStock).values([
      { article: "BP1234", brand: "Bosch", name: "Колодки тормозные передние", category: "Тормоза", qty: 12, price: 3200, location: "A-12", tenantId },
      { article: "OC90", brand: "Mahle", name: "Фильтр масляный", category: "Фильтры", qty: 45, price: 450, location: "B-03", tenantId },
      { article: "GDB1550", brand: "TRW", name: "Колодки задние", category: "Тормоза", qty: 8, price: 2100, location: "A-14", tenantId },
      { article: "LX3465", brand: "Knecht", name: "Фильтр воздушный", category: "Фильтры", qty: 22, price: 680, location: "B-05", tenantId },
      { article: "5W30-4L", brand: "Mobil", name: "Масло моторное 5W-30 4л", category: "Масла", qty: 30, price: 2800, location: "C-01", tenantId },
    ]);

    await tx.insert(schema.crmSettings).values({ tenantId, companyName });

    const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email));
    return user;
  });
}

export function currentSetupTenantId(): number {
  return getTenantId();
}
