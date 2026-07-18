import { db } from "../database";
import * as schema from "../database/schema";
import { phonesMatch, phoneNational10, phoneSearchVariants } from "./phone-normalize";
import { forTenant } from "./tenant-query";

export function sanitizeClientSearch(raw: string): { search: string; phoneDigits: string } {
  const search = raw.replace(/[\u200B-\u200D\uFEFF]/g, "").trim();
  const phoneDigits = search.replace(/\D/g, "");
  return { search, phoneDigits };
}

/** Хвост номера для сравнения (10 цифр без +7/8) */
function nationalTail(raw: string): string {
  const n10 = phoneNational10(raw);
  if (n10.length === 10) return n10;
  const d = raw.replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d;
}

export function clientMatchesPhone(
  storedPhone: string | null | undefined,
  search: string,
  phoneDigits: string,
): boolean {
  if (!storedPhone?.trim()) return false;

  const storedTail = nationalTail(storedPhone);
  const querySources = [search, phoneDigits, ...phoneSearchVariants(search), ...phoneSearchVariants(phoneDigits)];

  for (const q of querySources) {
    if (!q) continue;
    if (phonesMatch(storedPhone, q)) return true;
    const qTail = nationalTail(q);
    if (storedTail.length === 10 && qTail.length === 10 && storedTail === qTail) return true;
    if (qTail.length >= 7 && storedTail.endsWith(qTail)) return true;
    const storedRaw = storedPhone.replace(/\D/g, "");
    const qRaw = String(q).replace(/\D/g, "");
    if (qRaw.length >= 7 && storedRaw.includes(qRaw)) return true;
    if (qRaw.length === 10 && (storedRaw.endsWith(qRaw) || storedRaw.includes(qRaw))) return true;
  }
  return false;
}

function externalChatIdLooksLikePhone(externalChatId: string): boolean {
  const digits = externalChatId.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
}

export async function findClientIdsByPhoneInRelatedTables(
  search: string,
  phoneDigits: string,
): Promise<Set<number>> {
  const ids = new Set<number>();
  if (!phoneDigits || phoneDigits.length < 4) return ids;

  try {
    const callRows = await db
      .select({ clientId: schema.callLogs.clientId, phone: schema.callLogs.phone })
      .from(schema.callLogs)
      .where(forTenant(schema.callLogs));

    for (const row of callRows) {
      if (row.clientId != null && clientMatchesPhone(row.phone, search, phoneDigits)) {
        ids.add(row.clientId);
      }
    }
  } catch (e) {
    console.warn("[client-search] call_logs phone lookup failed:", e);
  }

  try {
    const convRows = await db
      .select({
        clientId: schema.conversations.clientId,
        externalChatId: schema.conversations.externalChatId,
      })
      .from(schema.conversations)
      .where(forTenant(schema.conversations));

    for (const row of convRows) {
      if (!row.externalChatId || !externalChatIdLooksLikePhone(row.externalChatId)) continue;
      if (clientMatchesPhone(row.externalChatId, search, phoneDigits)) {
        ids.add(row.clientId);
      }
    }
  } catch (e) {
    console.warn("[client-search] conversations phone lookup failed:", e);
  }

  try {
    const salesRows = await db
      .select({
        clientId: schema.salesDocuments.clientId,
        recipientPhone: schema.salesDocuments.recipientPhone,
      })
      .from(schema.salesDocuments)
      .where(forTenant(schema.salesDocuments));

    for (const row of salesRows) {
      if (row.clientId != null && clientMatchesPhone(row.recipientPhone, search, phoneDigits)) {
        ids.add(row.clientId);
      }
    }
  } catch (e) {
    console.warn("[client-search] sales_documents phone lookup failed:", e);
  }

  return ids;
}

export function clientMatchesSearch(
  client: { id: number; name: string; phone?: string | null; email?: string | null; notes?: string | null },
  search: string,
  phoneDigits: string,
  vehicleClientIds: Set<number>,
  phoneChannelClientIds: Set<number>,
): boolean {
  const q = search.toLowerCase();
  if (search && client.name.toLowerCase().includes(q)) return true;
  if (search && client.email?.toLowerCase().includes(q)) return true;
  if (search && client.notes?.toLowerCase().includes(q)) return true;
  if (clientMatchesPhone(client.phone, search, phoneDigits)) return true;
  if (vehicleClientIds.has(client.id)) return true;
  if (phoneChannelClientIds.has(client.id)) return true;
  return false;
}
