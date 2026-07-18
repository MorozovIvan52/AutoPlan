import { getCookie } from "hono/cookie";
import type { Context } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, ne, lt } from "drizzle-orm";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function createSession(userId: number): Promise<string> {
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await db.insert(schema.sessions).values({ id: sessionId, userId, expiresAt });
  return sessionId;
}

export async function destroySession(sessionId: string) {
  await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
}

export async function getSessionUserId(sessionId: string | undefined): Promise<number | undefined> {
  if (!sessionId) return undefined;
  const [row] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
  if (!row) return undefined;
  if (row.expiresAt < new Date()) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
    return undefined;
  }
  return row.userId;
}

export async function getAuthUser(c: Context) {
  const sid = getCookie(c, "session");
  const userId = await getSessionUserId(sid);
  if (!userId) return null;
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  if (!user || !user.isActive) return null;
  return user;
}

export function safeUser(user: typeof schema.users.$inferSelect) {
  const { passwordHash: _, ...safe } = user;
  return safe;
}

export async function cleanupExpiredSessions(): Promise<number> {
  const before = await db.select({ id: schema.sessions.id }).from(schema.sessions)
    .where(lt(schema.sessions.expiresAt, new Date()));
  if (!before.length) return 0;
  await db.delete(schema.sessions).where(lt(schema.sessions.expiresAt, new Date()));
  return before.length;
}

export async function revokeUserSessions(userId: number) {
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
}

export async function revokeOtherSessions(userId: number, keepSessionId: string) {
  await db.delete(schema.sessions).where(
    and(eq(schema.sessions.userId, userId), ne(schema.sessions.id, keepSessionId)),
  );
}

/** Новая сессия; старая (если была) удаляется. */
export async function rotateSession(oldSessionId: string | undefined, userId: number): Promise<string> {
  const newId = await createSession(userId);
  if (oldSessionId && oldSessionId !== newId) {
    await destroySession(oldSessionId);
  }
  return newId;
}
