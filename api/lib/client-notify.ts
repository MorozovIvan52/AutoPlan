import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and } from "drizzle-orm";
import { sendOutgoing } from "../services/messaging";
import { sendWhatsAppToClient, sendWhatsAppToPhone } from "../services/service-notify";
import { sendSms, smsConfigured } from "./sms";
import { notifyUser } from "./notify";
import { phonesMatch } from "./phone-normalize";
import { forTenant, withTenant } from "./tenant-query";

export type PreferredMessenger = "whatsapp" | "telegram" | "max" | "sms" | "avito" | "auto";

function channelMatches(type: string, slug: string, pref: PreferredMessenger): boolean {
  if (pref === "whatsapp") return type === "whatsapp" || slug.startsWith("whatsapp");
  if (pref === "telegram") return type === "telegram" || slug.startsWith("telegram");
  if (pref === "max") return type === "max" || slug.startsWith("max");
  if (pref === "avito") return type === "avito" || slug.startsWith("avito");
  if (pref === "sms") return false;
  return false;
}

async function findConversationByPreference(clientId: number, pref: PreferredMessenger) {
  const convs = await db.select().from(schema.conversations)
    .where(and(forTenant(schema.conversations), eq(schema.conversations.clientId, clientId)));
  for (const conv of convs) {
    let chType = conv.channelType || "";
    if (conv.channelId) {
      const [ch] = await db.select().from(schema.channels)
        .where(withTenant(schema.channels, eq(schema.channels.id, conv.channelId)));
      if (ch && channelMatches(ch.type, ch.slug, pref)) return { conv, channel: ch };
      chType = ch?.slug || chType;
    }
    if (channelMatches("", chType, pref)) {
      const [ch] = conv.channelId
        ? await db.select().from(schema.channels)
          .where(withTenant(schema.channels, eq(schema.channels.id, conv.channelId)))
        : await db.select().from(schema.channels)
          .where(and(forTenant(schema.channels), eq(schema.channels.slug, chType)))
          .limit(1);
      if (ch) return { conv, channel: ch };
    }
  }
  return null;
}

async function sendViaMessenger(
  clientId: number,
  text: string,
  pref: PreferredMessenger,
  senderId?: number,
): Promise<{ ok: boolean; channel?: string; error?: string }> {
  if (pref === "whatsapp") {
    const r = await sendWhatsAppToClient(clientId, text, senderId);
    return { ok: r.ok, channel: "whatsapp", error: r.error };
  }

  const found = await findConversationByPreference(clientId, pref);
  if (found) {
    try {
      await sendOutgoing(found.conv.id, text, senderId);
      return { ok: true, channel: pref };
    } catch (e: unknown) {
      return { ok: false, channel: pref, error: e instanceof Error ? e.message : String(e) };
    }
  }

  return { ok: false, error: `Нет диалога ${pref}` };
}

async function notifyOperatorsSmsFallback(clientId: number, phone: string, text: string) {
  const [client] = await db.select().from(schema.clients)
    .where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
  const operators = await db.select().from(schema.users)
    .where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
  const body = `SMS для ${client?.name || phone}: ${text}`;
  for (const op of operators) {
    await notifyUser({
      userId: op.id,
      type: "deal_updated",
      title: `📱 Отправьте SMS: ${client?.name || phone}`,
      text: body,
      link: clientId ? `/clients` : undefined,
    });
  }
}

export async function sendToClientPreferred(opts: {
  clientId?: number | null;
  phone?: string | null;
  text: string;
  preferredMessenger?: string | null;
  senderId?: number;
}): Promise<{ ok: boolean; channel?: string; error?: string }> {
  const { text, senderId } = opts;
  let clientId = opts.clientId ?? null;
  const phone = opts.phone?.trim() || null;

  if (!clientId && phone) {
    const tenantClients = await db.select().from(schema.clients).where(forTenant(schema.clients));
    const found = tenantClients.find((c) => c.phone && phonesMatch(c.phone, phone));
    if (found) clientId = found.id;
  }

  if (!clientId) {
    if (phone) {
      const r = await sendWhatsAppToPhone(phone, text, senderId);
      return { ok: r.ok, channel: "whatsapp", error: r.error };
    }
    return { ok: false, error: "Нет клиента и телефона" };
  }

  const [client] = await db.select().from(schema.clients)
    .where(withTenant(schema.clients, eq(schema.clients.id, clientId)));
  if (!client) return { ok: false, error: "Клиент не найден" };

  const pref = (opts.preferredMessenger || client.preferredMessenger || "auto") as PreferredMessenger;

  const order: PreferredMessenger[] = pref === "auto"
    ? ["whatsapp", "telegram", "max", "avito"]
    : pref === "sms"
      ? ["sms"]
      : [pref, "whatsapp", "telegram", "max", "avito"];

  for (const ch of order) {
    if (ch === "sms") {
      const p = client.phone || phone;
      if (p && smsConfigured()) {
        const r = await sendSms(p, text);
        if (r.ok) return { ok: true, channel: "sms" };
        return { ok: false, channel: "sms", error: r.error };
      }
      if (p) {
        await notifyOperatorsSmsFallback(clientId, p, text);
        return { ok: true, channel: "sms", error: "Задача на SMS создана оператору" };
      }
      continue;
    }
    const r = await sendViaMessenger(clientId, text, ch, senderId);
    if (r.ok) return r;
  }

  if (phone) {
    const r = await sendWhatsAppToPhone(phone, text, senderId);
    if (r.ok) return { ok: true, channel: "whatsapp" };
  }

  return { ok: false, error: "Не удалось отправить — нет подходящего канала" };
}
