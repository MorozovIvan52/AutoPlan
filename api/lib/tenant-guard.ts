import { db } from "../database";
import * as schema from "../database/schema";
import { eq, type SQL } from "drizzle-orm";
import { getTenantId, runWithTenant } from "./tenant-context";
import { forTenant, withTenant } from "./tenant-query";

type GuardResult<T> = { ok: true; row: T } | { ok: false; status: 404 };

async function one<T>(
  table: Parameters<typeof forTenant>[0],
  extra?: SQL,
): Promise<T | undefined> {
  const where = extra ? withTenant(table, extra) : forTenant(table);
  const [row] = await db.select().from(table as never).where(where).limit(1);
  return row as T | undefined;
}

export async function getClientInTenant(clientId: number) {
  return one<typeof schema.clients.$inferSelect>(schema.clients, eq(schema.clients.id, clientId));
}

export async function getDealInTenant(dealId: number) {
  return one<typeof schema.deals.$inferSelect>(schema.deals, eq(schema.deals.id, dealId));
}

export async function getConversationInTenant(conversationId: number) {
  return one<typeof schema.conversations.$inferSelect>(
    schema.conversations,
    eq(schema.conversations.id, conversationId),
  );
}

export async function getChannelInTenant(channelId: number) {
  return one<typeof schema.channels.$inferSelect>(schema.channels, eq(schema.channels.id, channelId));
}

export async function getChannelBySlugInTenant(slug: string) {
  return one<typeof schema.channels.$inferSelect>(schema.channels, eq(schema.channels.slug, slug));
}

export async function getUserInTenant(userId: number) {
  return one<typeof schema.users.$inferSelect>(schema.users, eq(schema.users.id, userId));
}

export async function getTaskInTenant(taskId: number) {
  return one<typeof schema.tasks.$inferSelect>(schema.tasks, eq(schema.tasks.id, taskId));
}

export async function getPartInTenant(partId: number) {
  return one<typeof schema.partsStock.$inferSelect>(schema.partsStock, eq(schema.partsStock.id, partId));
}

export async function getSalesDocInTenant(docId: number) {
  return one<typeof schema.salesDocuments.$inferSelect>(
    schema.salesDocuments,
    eq(schema.salesDocuments.id, docId),
  );
}

export async function getTagInTenant(tagId: number) {
  return one<typeof schema.tags.$inferSelect>(schema.tags, eq(schema.tags.id, tagId));
}

export async function assertClientInTenant(clientId: number): Promise<GuardResult<typeof schema.clients.$inferSelect>> {
  const row = await getClientInTenant(clientId);
  if (!row) return { ok: false, status: 404 };
  return { ok: true, row };
}

export async function assertDealInTenant(dealId: number): Promise<GuardResult<typeof schema.deals.$inferSelect>> {
  const row = await getDealInTenant(dealId);
  if (!row) return { ok: false, status: 404 };
  return { ok: true, row };
}

export async function assertConversationInTenant(
  conversationId: number,
): Promise<GuardResult<typeof schema.conversations.$inferSelect>> {
  const row = await getConversationInTenant(conversationId);
  if (!row) return { ok: false, status: 404 };
  return { ok: true, row };
}

export async function assertChannelBelongsToTenant(
  channel: typeof schema.channels.$inferSelect | undefined,
): Promise<GuardResult<typeof schema.channels.$inferSelect>> {
  if (!channel) return { ok: false, status: 404 };
  const tid = getTenantId();
  if ((channel.tenantId ?? 1) !== tid) return { ok: false, status: 404 };
  return { ok: true, row: channel };
}

export function channelTenantId(channel: { tenantId?: number | null }): number {
  return channel.tenantId ?? 1;
}

/** Вебхуки: тенант определяется каналом, а не Host */
export function runAsChannelTenant<T>(
  channel: { tenantId?: number | null },
  fn: () => T | Promise<T>,
): Promise<T> {
  const tid = channelTenantId(channel);
  return Promise.resolve(runWithTenant({ tenantId: tid }, fn));
}
