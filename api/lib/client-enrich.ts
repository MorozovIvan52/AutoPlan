import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, inArray, desc } from "drizzle-orm";
import { extractVin } from "./auto";
import { parseConvMetadata } from "./conv-meta";
import { isAvitoAccountLabel } from "./avito-context";

export function extractPhone(text: string): string | null {
  if (!text) return null;
  const normalized = text.replace(/[^\d+()\s\-]/g, " ");
  const patterns = [
    /(?:\+7|8)[\s\-()]?\d{3}[\s\-()]?\d{3}[\s\-()]?\d{2}[\s\-()]?\d{2}/,
    /\+7\d{10}/,
    /\b9\d{9}\b/,
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m) return formatPhone(m[0]);
  }
  return null;
}

export function formatPhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 11 && (digits.startsWith("8") || digits.startsWith("7"))) {
    return `+7 ${digits.slice(1, 4)} ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  if (digits.length === 10 && digits.startsWith("9")) {
    return `+7 ${digits.slice(0, 3)} ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }
  return raw.trim();
}

export function isGenericClientName(name: string | null | undefined, accountName?: string | null): boolean {
  if (!name) return true;
  const n = name.trim().toLowerCase();
  return n.length < 2
    || /^(клиент|пользователь|user|unknown|неизвестн|гость)/i.test(n)
    || n === "клиент авито"
    || isAvitoAccountLabel(name, accountName);
}

/** Имя покупателя для карточки клиента Авито */
export function resolveAvitoClientName(opts: {
  buyerName?: string | null;
  senderName?: string | null;
  accountName?: string | null;
}): string {
  for (const raw of [opts.buyerName, opts.senderName]) {
    const name = raw?.trim();
    if (!name) continue;
    if (isAvitoAccountLabel(name, opts.accountName)) continue;
    if (isGenericClientName(name, opts.accountName)) continue;
    return name;
  }
  return "Клиент Авито";
}

export function shouldReplaceClientName(
  currentName: string,
  nextName: string,
  accountName?: string | null,
): boolean {
  if (!nextName || isAvitoAccountLabel(nextName, accountName) || isGenericClientName(nextName, accountName)) {
    return false;
  }
  if (currentName === nextName) return false;
  if (isAvitoAccountLabel(currentName, accountName) || isGenericClientName(currentName, accountName)) {
    return true;
  }
  return false;
}

export type DialogEnrichInput = {
  senderName?: string;
  messageText?: string;
  phone?: string;
  avitoItemTitle?: string;
};

export function buildClientPatch(
  current: { name: string; phone?: string | null; productInterest?: string | null },
  input: DialogEnrichInput,
): Partial<typeof schema.clients.$inferInsert> {
  const patch: Partial<typeof schema.clients.$inferInsert> = {};

  const name = input.senderName?.trim();
  if (name && isGenericClientName(current.name)) {
    patch.name = name;
  }

  const phone = input.phone || (input.messageText ? extractPhone(input.messageText) : null);
  if (phone && (!current.phone || current.phone.replace(/\D/g, "").length < 10)) {
    patch.phone = phone;
  }

  const product = input.avitoItemTitle?.trim();
  if (product && !current.productInterest) {
    patch.productInterest = product;
  }

  return patch;
}

async function ensureVins(clientId: number, texts: string[]) {
  for (const text of texts) {
    const vin = extractVin(text);
    if (!vin) continue;
    const existing = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, clientId));
    if (!existing.some((v) => v.vin === vin)) {
      await db.insert(schema.vehicles).values({ clientId, vin });
    }
  }
}

export async function enrichClientOnMessage(
  clientId: number,
  input: DialogEnrichInput & { messageText: string },
) {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client) return;

  const patch = buildClientPatch(
    { name: client.name, phone: client.phone, productInterest: client.productInterest },
    input,
  );

  if (Object.keys(patch).length) {
    patch.updatedAt = new Date();
    await db.update(schema.clients).set(patch).where(eq(schema.clients.id, clientId));
  }

  await ensureVins(clientId, [input.messageText]);
}

export async function enrichClientFromDialogs(
  clientId: number,
  conversationId?: number,
): Promise<typeof schema.clients.$inferSelect | null> {
  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!client) return null;

  let convs = conversationId
    ? await db.select().from(schema.conversations).where(
        and(eq(schema.conversations.clientId, clientId), eq(schema.conversations.id, conversationId)),
      )
    : await db.select().from(schema.conversations).where(eq(schema.conversations.clientId, clientId));

  const convIds = convs.map((c) => c.id);
  const clientMessages = convIds.length
    ? await db.select().from(schema.messages).where(
        and(
          inArray(schema.messages.conversationId, convIds),
          eq(schema.messages.senderType, "client"),
        ),
      ).orderBy(desc(schema.messages.createdAt))
      .limit(100)
    : [];

  const texts = clientMessages.map((m) => m.text || "").filter(Boolean);

  let state = {
    name: client.name,
    phone: client.phone,
    productInterest: client.productInterest,
  };
  const merged: Partial<typeof schema.clients.$inferInsert> = {};

  for (const conv of convs) {
    const meta = parseConvMetadata(conv.metadata);
    const p = buildClientPatch(state, {
      avitoItemTitle: meta?.avitoItemTitle,
      ...(conversationId ? { senderName: undefined } : {}),
    });
    if (conversationId && meta?.avitoItemTitle) {
      p.productInterest = meta.avitoItemTitle;
    }
    Object.assign(merged, p);
    state = { ...state, ...p };
  }

  for (const text of texts) {
    const p = buildClientPatch(state, { messageText: text });
    Object.assign(merged, p);
    state = { ...state, ...p };
  }

  if (Object.keys(merged).length === 0) {
    await ensureVins(clientId, texts);
    return client;
  }

  merged.updatedAt = new Date();
  const [updated] = await db.update(schema.clients)
    .set(merged)
    .where(eq(schema.clients.id, clientId))
    .returning();

  await ensureVins(clientId, texts);
  return updated;
}
