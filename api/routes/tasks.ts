import { Hono } from "hono";

import { db } from "../database";

import * as schema from "../database/schema";

import { eq, desc, asc, and, isNotNull, lt, inArray } from "drizzle-orm";

import { requireAuth } from "../middleware/auth";
import { trackActivityEvent } from "../lib/activity-track";
import { filterByDemoClients, isDemoUser } from "../lib/demo-mode";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getTaskInTenant } from "../lib/tenant-guard";

import { notifyUser } from "../lib/notify";



async function enrichTask(task: typeof schema.tasks.$inferSelect) {

  const [client] = task.clientId

    ? await db.select().from(schema.clients).where(eq(schema.clients.id, task.clientId))

    : [null];

  const [assignee] = task.assignedTo

    ? await db.select().from(schema.users).where(eq(schema.users.id, task.assignedTo))

    : [null];

  const [creator] = task.createdBy

    ? await db.select().from(schema.users).where(eq(schema.users.id, task.createdBy))

    : [null];

  const comments = await db

    .select({ comment: schema.taskComments, user: schema.users })

    .from(schema.taskComments)

    .leftJoin(schema.users, eq(schema.taskComments.userId, schema.users.id))

    .where(eq(schema.taskComments.taskId, task.id))

    .orderBy(asc(schema.taskComments.createdAt));



  return {

    ...task,

    clientName: client?.name ?? null,

    assigneeName: assignee?.name ?? null,

    creatorName: creator?.name ?? null,

    comments: comments.map(({ comment, user }) => ({

      ...comment,

      userName: user?.name ?? "Оператор",

    })),

  };

}



export const tasks = new Hono()

  .use("*", requireAuth)

  .get("/", async (c) => {

    const status = c.req.query("status");

    const assignedTo = c.req.query("assignedTo");

    const mine = c.req.query("mine");

    const userId = c.get("userId") as number;



    const rows = await db
      .select({ task: schema.tasks, client: schema.clients, assignee: schema.users })
      .from(schema.tasks)
      .leftJoin(schema.clients, eq(schema.tasks.clientId, schema.clients.id))
      .leftJoin(schema.users, eq(schema.tasks.assignedTo, schema.users.id))
      .where(forTenant(schema.tasks))
      .orderBy(desc(schema.tasks.createdAt));



    let all = rows.map(({ task, client, assignee }) => ({

      ...task,

      clientName: client?.name ?? null,

      assigneeName: assignee?.name ?? null,

    }));



    if (status) all = all.filter((t) => t.status === status);

    if (assignedTo) all = all.filter((t) => String(t.assignedTo) === assignedTo);

    if (mine === "1") all = all.filter((t) => t.assignedTo === userId);

    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      all = await filterByDemoClients(user, all);
    }

    return c.json({ tasks: all }, 200);

  })

  .get("/overdue-summary", async (c) => {

    const userId = c.get("userId") as number;

    const now = new Date();

    const rows = await db.select().from(schema.tasks).where(

      and(
        forTenant(schema.tasks),
        eq(schema.tasks.assignedTo, userId),

        isNotNull(schema.tasks.dueAt),

        lt(schema.tasks.dueAt, now),

        inArray(schema.tasks.status, ["todo", "in_progress"]),

      ),

    );



    return c.json({

      count: rows.length,

      tasks: rows.map((t) => ({

        id: t.id,

        title: t.title,

        dueAt: t.dueAt,

        priority: t.priority,

      })),

    });

  })

  .get("/:id", async (c) => {

    const id = parseInt(c.req.param("id"));

    const task = await getTaskInTenant(id);
    if (!task) return c.json({ error: "Задача не найдена" }, 404);

    return c.json({ task: await enrichTask(task) }, 200);

  })

  .post("/", async (c) => {

    const body = await c.req.json();

    const title = (body.title || "").trim();

    if (!title) return c.json({ error: "Укажите название задачи" }, 400);



    const userId = c.get("userId") as number;

    const assignedTo = body.assignedTo || userId;

    const dueAt = body.dueAt ? new Date(body.dueAt) : null;

    if (dueAt && Number.isNaN(dueAt.getTime())) {

      return c.json({ error: "Некорректная дата напоминания" }, 400);

    }



    const [task] = await db.insert(schema.tasks).values({

      title,

      description: body.description?.trim() || null,

      status: body.status || "todo",

      priority: body.priority || "medium",

      clientId: body.clientId ?? null,

      assignedTo,

      createdBy: userId,

      dueAt: dueAt ?? undefined,
      tenantId: tenantId(),
    }).returning();

    void trackActivityEvent(userId, "task_created", "task", task.id, { title: task.title });

    if (assignedTo && assignedTo !== userId) {

      await notifyUser({

        userId: assignedTo,

        type: "assigned",

        title: "📋 Вам назначена задача",

        text: title,

        link: `/tasks?task=${task.id}`,

      });

    } else if (assignedTo && dueAt) {

      const dueLabel = dueAt.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

      await notifyUser({

        userId: assignedTo,

        type: "task_due",

        title: "📅 Задача запланирована",

        text: `${title} — ${dueLabel}`,

        link: `/tasks?task=${task.id}`,

      });

    }



    return c.json({ task: await enrichTask(task) }, 201);

  })

  .patch("/:id", async (c) => {

    const id = parseInt(c.req.param("id"));

    const body = await c.req.json();

    const existing = await getTaskInTenant(id);
    if (!existing) return c.json({ error: "Задача не найдена" }, 404);



    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title != null) updates.title = String(body.title).trim();

    if (body.description != null) updates.description = body.description || null;

    if (body.status != null) updates.status = body.status;

    if (body.priority != null) updates.priority = body.priority;

    if (body.assignedTo != null) updates.assignedTo = body.assignedTo ? Number(body.assignedTo) : null;

    if (body.clientId != null) updates.clientId = body.clientId ? Number(body.clientId) : null;

    if (body.dueAt !== undefined) {

      updates.dueAt = body.dueAt ? new Date(body.dueAt) : null;

      updates.notifiedAt = null;

      updates.reminded15At = null;

      updates.reminded5At = null;

      updates.overdueNotifiedAt = null;

    }



    const [task] = await db.update(schema.tasks)

      .set(updates)

      .where(withTenant(schema.tasks, eq(schema.tasks.id, id)))

      .returning();

    const userId = c.get("userId") as number;
    if (body.status === "done" && existing.status !== "done") {
      void trackActivityEvent(userId, "task_done", "task", task.id);
    }

    const newAssignee = updates.assignedTo as number | undefined;

    if (newAssignee && newAssignee !== existing.assignedTo) {

      const changerId = c.get("userId") as number;

      const [changer] = await db.select().from(schema.users).where(eq(schema.users.id, changerId));

      await notifyUser({

        userId: newAssignee,

        type: "assigned",

        title: "📋 Задача передана вам",

        text: `${task.title}${changer?.name ? ` · от ${changer.name}` : ""}`,

        link: `/tasks?task=${task.id}`,

      });

    }



    return c.json({ task: await enrichTask(task) }, 200);

  })

  .post("/:id/comments", async (c) => {

    const id = parseInt(c.req.param("id"));

    const body = await c.req.json();

    const text = (body.text || "").trim();

    if (!text) return c.json({ error: "Введите комментарий" }, 400);



    const task = await getTaskInTenant(id);
    if (!task) return c.json({ error: "Задача не найдена" }, 404);



    const userId = c.get("userId") as number;

    const [comment] = await db.insert(schema.taskComments).values({

      taskId: id,

      userId,

      text,

    }).returning();



    const [author] = await db.select().from(schema.users).where(eq(schema.users.id, userId));



    const notifyIds = new Set<number>();

    if (task.assignedTo && task.assignedTo !== userId) notifyIds.add(task.assignedTo);

    if (task.createdBy && task.createdBy !== userId) notifyIds.add(task.createdBy);



    for (const uid of notifyIds) {

      await notifyUser({

        userId: uid,

        type: "mention",

        title: "💬 Комментарий к задаче",

        text: `${author?.name || "Коллега"}: ${text.slice(0, 80)}`,

        link: `/tasks?task=${id}`,

      });

    }



    return c.json({

      comment: { ...comment, userName: author?.name ?? "Оператор" },

    }, 201);

  })

  .delete("/:id", async (c) => {

    const id = parseInt(c.req.param("id"));

    await db.delete(schema.tasks).where(withTenant(schema.tasks, eq(schema.tasks.id, id)));

    return c.json({ ok: true }, 200);

  });


