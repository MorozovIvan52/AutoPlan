/**
 * Автосоздание заказов из входящих: Авито, мессенджеры, звонки.
 * Флаг: crm_settings.avito_auto_deals (общий переключатель в UI).
 */
import { eq } from "drizzle-orm";
import { db } from "../database";
import * as schema from "../database/schema";
import { getCrmSettings } from "./crm-settings";
import { tenantId } from "./tenant-query";
import { log } from "./logger";

const ACTIVE = new Set(["done", "cancelled"]);

function isActiveDeal(status: string | null | undefined): boolean {
  return !ACTIVE.has(String(status || "new"));
}

export function channelLabel(channelType: string): string {
  switch (channelType) {
    case "avito": return "Авито";
    case "telegram": return "Telegram";
    case "whatsapp": return "WhatsApp";
    case "max": return "MAX";
    case "vk": return "VK";
    case "sms": return "SMS";
    case "call": return "Звонок";
    default: return "Мессенджер";
  }
}

function markerForConversation(conversationId: number): string {
  return `[auto:conv:${conversationId}]`;
}

function markerForAvitoItem(itemId: string): string {
  return `[auto:avito:${itemId}]`;
}

function markerForCall(phoneNorm: string): string {
  return `[auto:call:${phoneNorm}]`;
}

function dealHasMarker(description: string | null | undefined, marker: string): boolean {
  return Boolean(description && description.includes(marker));
}

export async function isAutoDealsEnabled(): Promise<boolean> {
  const s = await getCrmSettings();
  return Boolean(s.avitoAutoDeals);
}

/** Сообщение клиента в чате → заказ (Авито по объявлению или 1 активный на диалог). */
export async function maybeCreateAutoDealFromMessage(opts: {
  clientId: number;
  conversationId: number;
  channelType: string;
  externalChatId?: string | null;
  avitoItemId?: string | null;
  avitoItemTitle?: string | null;
  avitoPrice?: number | null;
}): Promise<number | null> {
  if (!(await isAutoDealsEnabled())) return null;

  const existing = await db
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.clientId, opts.clientId));

  const itemId = (opts.avitoItemId || "").trim();
  const itemTitle = (opts.avitoItemTitle || "").trim();

  if (itemId && itemTitle) {
    const has = existing.some(
      (d) => d.avitoItemId === itemId && isActiveDeal(d.status),
    );
    if (has) return null;

    const marker = markerForAvitoItem(itemId);
    const [row] = await db.insert(schema.deals).values({
      tenantId: tenantId(),
      clientId: opts.clientId,
      title: itemTitle,
      orderType: "parts",
      status: "new",
      avitoItemId: itemId,
      avitoItemTitle: itemTitle,
      avitoPrice: opts.avitoPrice ?? null,
      amount: opts.avitoPrice ?? null,
      description: `Автозаказ · Авито · чат ${opts.externalChatId || "—"} ${marker}`,
    }).returning();

    log.info({ dealId: row.id, clientId: opts.clientId, source: "avito" }, "auto_deal_created");
    return row.id;
  }

  const marker = markerForConversation(opts.conversationId);
  const has = existing.some(
    (d) => isActiveDeal(d.status) && dealHasMarker(d.description, marker),
  );
  if (has) return null;

  const label = channelLabel(opts.channelType);
  const title = `Обращение · ${label}`;
  const [row] = await db.insert(schema.deals).values({
    tenantId: tenantId(),
    clientId: opts.clientId,
    title,
    orderType: opts.channelType === "avito" ? "parts" : "service",
    status: "new",
    description: `Автозаказ · ${label} · диалог #${opts.conversationId} ${marker}`,
  }).returning();

  log.info({
    dealId: row.id,
    clientId: opts.clientId,
    source: opts.channelType,
    conversationId: opts.conversationId,
  }, "auto_deal_created");
  return row.id;
}

/** Входящий звонок → клиент (если нет) + один активный автозаказ на номер. */
export async function maybeCreateAutoDealFromCall(opts: {
  phone: string;
  clientId?: number | null;
  clientName?: string | null;
  assignedUserId?: number | null;
  callId?: number | null;
}): Promise<{ clientId: number | null; dealId: number | null }> {
  if (!(await isAutoDealsEnabled())) {
    return { clientId: opts.clientId ?? null, dealId: null };
  }

  const phone = (opts.phone || "").trim();
  if (!phone) return { clientId: opts.clientId ?? null, dealId: null };

  let clientId = opts.clientId ?? null;
  if (!clientId) {
    const [created] = await db.insert(schema.clients).values({
      tenantId: tenantId(),
      name: (opts.clientName || "").trim() || `Звонок ${phone}`,
      phone,
      source: "call",
    }).returning();
    clientId = created.id;
  }

  const phoneNorm = phone.replace(/\D/g, "");
  const marker = markerForCall(phoneNorm || phone);
  const existing = await db
    .select()
    .from(schema.deals)
    .where(eq(schema.deals.clientId, clientId));

  const has = existing.some(
    (d) => isActiveDeal(d.status) && (
      dealHasMarker(d.description, marker)
      || (d.title || "").startsWith("Звонок ·")
    ),
  );
  if (has) return { clientId, dealId: null };

  const [row] = await db.insert(schema.deals).values({
    tenantId: tenantId(),
    clientId,
    title: `Звонок · ${phone}`,
    orderType: "service",
    status: "new",
    assignedTo: opts.assignedUserId ?? null,
    description: `Автозаказ · звонок${opts.callId ? ` #${opts.callId}` : ""} ${marker}`,
  }).returning();

  log.info({ dealId: row.id, clientId, source: "call", callId: opts.callId }, "auto_deal_created");
  return { clientId, dealId: row.id };
}
