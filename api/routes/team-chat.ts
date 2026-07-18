import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, desc, sql, inArray, gt } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { broadcast, broadcastToUsers } from "../services/ws";
import { notifyUser } from "../lib/notify";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";

const DEFAULT_GROUPS = [
  { name: "Общий", description: "Обсуждение рабочих вопросов", icon: "💬" },
  { name: "СТО и ремонт", description: "Записи, диагностика, ремонт", icon: "🔧" },
  { name: "Склад и запчасти", description: "Наличие, подбор, заказы поставщикам", icon: "🏭" },
  { name: "Доставка", description: "СДЭК, отправки, самовывоз", icon: "🚚" },
  { name: "Продажи и заказы", description: "Сделки, КП, оплата", icon: "📦" },
];

async function ensureDefaultGroups() {
  const existing = await db.select({ id: schema.teamChatGroups.id }).from(schema.teamChatGroups)
    .where(forTenant(schema.teamChatGroups))
    .limit(1);
  if (existing.length) return;
  await db.insert(schema.teamChatGroups).values(
    DEFAULT_GROUPS.map((g) => ({ ...g, isPublic: true, tenantId: tenantId() }))
  );
}

async function ensureMembership(groupId: number, userId: number) {
  const [member] = await db.select().from(schema.teamChatMembers)
    .where(and(eq(schema.teamChatMembers.groupId, groupId), eq(schema.teamChatMembers.userId, userId)));
  if (!member) {
    await db.insert(schema.teamChatMembers).values({ groupId, userId });
  }
}

async function canAccessGroup(groupId: number, userId: number, role: string): Promise<boolean> {
  const [group] = await db.select().from(schema.teamChatGroups)
    .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, groupId)));
  if (!group) return false;
  if (group.isPublic) {
    await ensureMembership(groupId, userId);
    return true;
  }
  const [member] = await db.select().from(schema.teamChatMembers)
    .where(and(eq(schema.teamChatMembers.groupId, groupId), eq(schema.teamChatMembers.userId, userId)));
  return !!member || role === "admin";
}

async function groupRecipientUserIds(groupId: number): Promise<number[]> {
  const [group] = await db.select().from(schema.teamChatGroups)
    .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, groupId)));
  if (!group) return [];
  if (group.isPublic) {
    const ops = await db.select({ id: schema.users.id }).from(schema.users)
      .where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
    return ops.map((o) => o.id);
  }
  const members = await db.select({ userId: schema.teamChatMembers.userId })
    .from(schema.teamChatMembers).where(eq(schema.teamChatMembers.groupId, groupId));
  const admins = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(forTenant(schema.users), eq(schema.users.isActive, true), eq(schema.users.role, "admin")));
  return [...new Set([...members.map((m) => m.userId), ...admins.map((a) => a.id)])];
}

function parseMentions(text: string, users: { id: number; name: string }[]): number[] {
  const mentioned: number[] = [];
  for (const u of users) {
    const pattern = new RegExp(`@${u.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    if (pattern.test(text)) mentioned.push(u.id);
  }
  return mentioned;
}

export const teamChat = new Hono()
  .use("*", requireAuth)

  .get("/groups", async (c) => {
    const userId = c.get("userId") as number;
    await ensureDefaultGroups();

    const groups = await db.select().from(schema.teamChatGroups)
      .where(forTenant(schema.teamChatGroups))
      .orderBy(desc(schema.teamChatGroups.lastMessageAt));

    const accessible: typeof groups = [];
    for (const g of groups) {
      if (await canAccessGroup(g.id, userId, c.get("user")?.role || "operator")) {
        accessible.push(g);
      }
    }

    const groupIds = accessible.map((g) => g.id);
    if (!groupIds.length) return c.json({ groups: [] }, 200);

    const members = await db.select().from(schema.teamChatMembers)
      .where(and(eq(schema.teamChatMembers.userId, userId), inArray(schema.teamChatMembers.groupId, groupIds)));

    const memberMap = new Map(members.map((m) => [m.groupId, m]));

    const lastMsgs = await db.select({
      groupId: schema.teamChatMessages.groupId,
      text: schema.teamChatMessages.text,
      createdAt: schema.teamChatMessages.createdAt,
      userName: schema.users.name,
    })
      .from(schema.teamChatMessages)
      .innerJoin(schema.users, eq(schema.teamChatMessages.userId, schema.users.id))
      .where(inArray(schema.teamChatMessages.groupId, groupIds))
      .orderBy(desc(schema.teamChatMessages.createdAt));

    const previewMap = new Map<number, { text: string; createdAt: Date | null; userName: string }>();
    for (const m of lastMsgs) {
      if (!previewMap.has(m.groupId)) {
        previewMap.set(m.groupId, { text: m.text || "", createdAt: m.createdAt, userName: m.userName });
      }
    }

    const unreadCounts = await Promise.all(groupIds.map(async (gid) => {
      const member = memberMap.get(gid);
      const lastRead = member?.lastReadAt;
      const where = lastRead
        ? and(eq(schema.teamChatMessages.groupId, gid), gt(schema.teamChatMessages.createdAt, lastRead))
        : eq(schema.teamChatMessages.groupId, gid);
      const rows = await db.select({ count: sql<number>`count(*)` })
        .from(schema.teamChatMessages)
        .where(where);
      return { gid, count: Number(rows[0]?.count || 0) };
    }));

    const unreadMap = new Map(unreadCounts.map((u) => [u.gid, u.count]));

    return c.json({
      groups: accessible.map((g) => {
        const preview = previewMap.get(g.id);
        return {
          ...g,
          unreadCount: unreadMap.get(g.id) || 0,
          lastPreview: preview?.text?.slice(0, 80) || null,
          lastAuthor: preview?.userName || null,
          lastMessageAt: preview?.createdAt || g.lastMessageAt,
        };
      }),
    }, 200);
  })

  .post("/groups", async (c) => {
    const userId = c.get("userId") as number;
    const body = await c.req.json();
    const name = (body.name || "").trim();
    if (!name) return c.json({ error: "Укажите название группы" }, 400);

    const [group] = await db.insert(schema.teamChatGroups).values({
      name,
      description: body.description?.trim() || null,
      icon: body.icon || "💬",
      dealId: body.dealId ? Number(body.dealId) : null,
      isPublic: body.isPublic !== false,
      createdBy: userId,
      tenantId: tenantId(),
    }).returning();

    await db.insert(schema.teamChatMembers).values({ groupId: group.id, userId });

    if (body.memberIds?.length) {
      const ids = (body.memberIds as number[]).filter((id) => id !== userId);
      if (ids.length) {
        await db.insert(schema.teamChatMembers).values(
          ids.map((uid) => ({ groupId: group.id, userId: uid }))
        );
      }
    }

    return c.json({ group }, 201);
  })

  .patch("/groups/:id", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const role = c.get("user")?.role;
    const [group] = await db.select().from(schema.teamChatGroups)
      .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, id)));
    if (!group) return c.json({ error: "Not found" }, 404);
    if (group.createdBy !== userId && role !== "admin") return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json();
    const update: Record<string, unknown> = {};
    if (body.name) update.name = body.name.trim();
    if (body.description !== undefined) update.description = body.description?.trim() || null;
    if (body.icon) update.icon = body.icon;
    if (body.isPublic !== undefined) update.isPublic = body.isPublic;

    const [updated] = await db.update(schema.teamChatGroups).set(update)
      .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, id))).returning();
    return c.json({ group: updated }, 200);
  })

  .get("/groups/:id/messages", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const role = c.get("user")?.role || "operator";
    if (!(await canAccessGroup(id, userId, role))) return c.json({ error: "Forbidden" }, 403);

    const limit = Math.min(parseInt(c.req.query("limit") || "100"), 200);
    const rows = await db.select({
      id: schema.teamChatMessages.id,
      groupId: schema.teamChatMessages.groupId,
      userId: schema.teamChatMessages.userId,
      text: schema.teamChatMessages.text,
      fileUrl: schema.teamChatMessages.fileUrl,
      fileName: schema.teamChatMessages.fileName,
      replyToId: schema.teamChatMessages.replyToId,
      createdAt: schema.teamChatMessages.createdAt,
      userName: schema.users.name,
      userAvatar: schema.users.avatarUrl,
    })
      .from(schema.teamChatMessages)
      .innerJoin(schema.users, eq(schema.teamChatMessages.userId, schema.users.id))
      .where(eq(schema.teamChatMessages.groupId, id))
      .orderBy(desc(schema.teamChatMessages.createdAt))
      .limit(limit);

    return c.json({ messages: rows.reverse() }, 200);
  })

  .post("/groups/:id/messages", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const user = c.get("user");
    const role = user?.role || "operator";
    if (!(await canAccessGroup(id, userId, role))) return c.json({ error: "Forbidden" }, 403);

    const body = await c.req.json();
    const text = (body.text || "").trim();
    if (!text && !body.fileUrl) return c.json({ error: "Пустое сообщение" }, 400);

    const [group] = await db.select().from(schema.teamChatGroups)
      .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, id)));
    if (!group) return c.json({ error: "Not found" }, 404);

    const [message] = await db.insert(schema.teamChatMessages).values({
      groupId: id,
      userId,
      text: text || null,
      fileUrl: body.fileUrl || null,
      fileName: body.fileName || null,
      replyToId: body.replyToId ? Number(body.replyToId) : null,
    }).returning();

    await db.update(schema.teamChatGroups)
      .set({ lastMessageAt: new Date() })
      .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, id)));

    const allUsers = await db.select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users).where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
    const mentionedIds = parseMentions(text, allUsers).filter((uid) => uid !== userId);

    for (const uid of mentionedIds) {
      await notifyUser({
        userId: uid,
        type: "mention",
        title: `${user?.name} упомянул вас`,
        text: text.slice(0, 120),
        link: `/team?group=${id}`,
      });
    }

    const payload = {
      ...message,
      userName: user?.name,
      userAvatar: user?.avatarUrl,
      groupName: group.name,
    };

    const recipients = await groupRecipientUserIds(id);
    broadcastToUsers(recipients, {
      type: "team_message",
      groupId: id,
      message: payload,
      mentionedUserIds: mentionedIds,
    });

    return c.json({ message: payload }, 201);
  })

  .delete("/groups/:id/messages/:msgId", async (c) => {
    const groupId = parseInt(c.req.param("id"));
    const msgId = parseInt(c.req.param("msgId"));
    const userId = c.get("userId") as number;
    const role = c.get("user")?.role || "operator";

    if (!Number.isFinite(groupId) || !Number.isFinite(msgId)) {
      return c.json({ error: "Некорректный запрос" }, 400);
    }
    if (!(await canAccessGroup(groupId, userId, role))) return c.json({ error: "Forbidden" }, 403);

    const [message] = await db.select().from(schema.teamChatMessages)
      .where(and(eq(schema.teamChatMessages.id, msgId), eq(schema.teamChatMessages.groupId, groupId)));
    if (!message) return c.json({ error: "Сообщение не найдено" }, 404);

    if (role !== "admin" && message.userId !== userId) {
      return c.json({ error: "Можно удалять только свои сообщения" }, 403);
    }

    await db.delete(schema.teamChatMessages).where(eq(schema.teamChatMessages.id, msgId));

    const [last] = await db.select({ createdAt: schema.teamChatMessages.createdAt })
      .from(schema.teamChatMessages)
      .where(eq(schema.teamChatMessages.groupId, groupId))
      .orderBy(desc(schema.teamChatMessages.createdAt))
      .limit(1);

    await db.update(schema.teamChatGroups)
      .set({ lastMessageAt: last?.createdAt || null })
      .where(eq(schema.teamChatGroups.id, groupId));

    const recipients = await groupRecipientUserIds(groupId);
    broadcastToUsers(recipients, { type: "team_message_deleted", groupId, messageId: msgId });

    return c.json({ ok: true }, 200);
  })

  .post("/groups/:id/read", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const role = c.get("user")?.role || "operator";
    if (!(await canAccessGroup(id, userId, role))) return c.json({ error: "Forbidden" }, 403);

    const now = new Date();
    const [existing] = await db.select().from(schema.teamChatMembers)
      .where(and(eq(schema.teamChatMembers.groupId, id), eq(schema.teamChatMembers.userId, userId)));

    if (existing) {
      await db.update(schema.teamChatMembers)
        .set({ lastReadAt: now })
        .where(eq(schema.teamChatMembers.id, existing.id));
    } else {
      await db.insert(schema.teamChatMembers).values({ groupId: id, userId, lastReadAt: now });
    }

    return c.json({ ok: true }, 200);
  })

  .get("/groups/:id/members", async (c) => {
    const id = parseInt(c.req.param("id"));
    const userId = c.get("userId") as number;
    const role = c.get("user")?.role || "operator";
    if (!(await canAccessGroup(id, userId, role))) return c.json({ error: "Forbidden" }, 403);

    const [group] = await db.select().from(schema.teamChatGroups)
      .where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, id)));
    if (!group) return c.json({ error: "Not found" }, 404);

    if (group.isPublic) {
      const all = await db.select({
        id: schema.users.id,
        name: schema.users.name,
        role: schema.users.role,
        avatarUrl: schema.users.avatarUrl,
      }).from(schema.users).where(and(forTenant(schema.users), eq(schema.users.isActive, true)));
      return c.json({ members: all, isPublic: true }, 200);
    }

    const members = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      role: schema.users.role,
      avatarUrl: schema.users.avatarUrl,
    })
      .from(schema.teamChatMembers)
      .innerJoin(schema.users, eq(schema.teamChatMembers.userId, schema.users.id))
      .where(eq(schema.teamChatMembers.groupId, id));

    return c.json({ members, isPublic: false }, 200);
  })

  .post("/groups/:id/members", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    const body = await c.req.json();
    const uid = Number(body.userId);
    if (!uid) return c.json({ error: "userId required" }, 400);

    const [existing] = await db.select().from(schema.teamChatMembers)
      .where(and(eq(schema.teamChatMembers.groupId, id), eq(schema.teamChatMembers.userId, uid)));
    if (!existing) {
      await db.insert(schema.teamChatMembers).values({ groupId: id, userId: uid });
    }
    return c.json({ ok: true }, 200);
  })

  .delete("/groups/:id", requireAdmin, async (c) => {
    const id = parseInt(c.req.param("id"));
    await db.delete(schema.teamChatGroups).where(withTenant(schema.teamChatGroups, eq(schema.teamChatGroups.id, id)));
    return c.json({ ok: true }, 200);
  });
