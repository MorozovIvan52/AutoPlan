import { Hono } from "hono";

import { db } from "../database";

import * as schema from "../database/schema";

import { eq, asc, and } from "drizzle-orm";

import { requireAuth, requireAdmin } from "../middleware/auth";
import { isDemoUser, getDemoClientIds } from "../lib/demo-mode";
import { isAppointmentInSchedule } from "../lib/appointment-schedule";

import { formatWeeklySchedule, formatAppointmentMessage } from "../lib/service-format";

import { broadcastScheduleWhatsApp } from "../services/service-notify";
import { sendToClientPreferred } from "../lib/client-notify";
import { forTenant, tenantId, withTenant } from "../lib/tenant-query";
import { getClientInTenant, getDealInTenant } from "../lib/tenant-guard";



const DEFAULT_SCHEDULE = [

  { dayOfWeek: 0, openTime: "09:00", closeTime: "19:00", isClosed: false },

  { dayOfWeek: 1, openTime: "09:00", closeTime: "19:00", isClosed: false },

  { dayOfWeek: 2, openTime: "09:00", closeTime: "19:00", isClosed: false },

  { dayOfWeek: 3, openTime: "09:00", closeTime: "19:00", isClosed: false },

  { dayOfWeek: 4, openTime: "09:00", closeTime: "19:00", isClosed: false },

  { dayOfWeek: 5, openTime: "10:00", closeTime: "16:00", isClosed: false },

  { dayOfWeek: 6, openTime: "00:00", closeTime: "00:00", isClosed: true },

];



async function ensureSchedule() {

  const existing = await db.select().from(schema.serviceSchedule).where(forTenant(schema.serviceSchedule));

  if (existing.length >= 7) return existing;

  await db.delete(schema.serviceSchedule).where(forTenant(schema.serviceSchedule));

  await db.insert(schema.serviceSchedule).values(DEFAULT_SCHEDULE.map((row) => ({ ...row, tenantId: tenantId() })));

  return db.select().from(schema.serviceSchedule)
    .where(forTenant(schema.serviceSchedule))
    .orderBy(asc(schema.serviceSchedule.dayOfWeek));

}



async function getSettings() {

  const [row] = await db.select().from(schema.serviceSettings)
    .where(forTenant(schema.serviceSettings))
    .limit(1);

  if (row) return row;

  const [created] = await db.insert(schema.serviceSettings).values({ tenantId: tenantId() }).returning();

  return created;

}



function pickCarFields(body: Record<string, unknown>) {

  return {

    phone: typeof body.phone === "string" ? body.phone.trim() || null : null,

    plate: typeof body.plate === "string" ? body.plate.trim() || null : null,

    make: typeof body.make === "string" ? body.make.trim() || null : null,

    model: typeof body.model === "string" ? body.model.trim() || null : null,

    vin: typeof body.vin === "string" ? body.vin.trim() || null : null,

    mileage: body.mileage != null && body.mileage !== "" ? Number(body.mileage) || null : null,

  };

}



async function resolveVehicleId(clientId: number, body: Record<string, unknown>): Promise<number | null> {

  if (body.vehicleId) return Number(body.vehicleId);



  const car = pickCarFields(body);

  if (!car.vin && !car.make && !car.model && !car.plate) return null;



  const existing = await db.select().from(schema.vehicles).where(eq(schema.vehicles.clientId, clientId));

  if (car.vin) {

    const found = existing.find((v) => v.vin === car.vin);

    if (found) return found.id;

  }



  const [vehicle] = await db.insert(schema.vehicles).values({

    clientId,

    vin: car.vin,

    make: car.make,

    model: car.model,

    plate: car.plate,

  }).returning();

  return vehicle.id;

}



function mapAppointmentRow({ appointment, client, vehicle, deal }: {

  appointment: typeof schema.serviceAppointments.$inferSelect;

  client: typeof schema.clients.$inferSelect | null;

  vehicle: typeof schema.vehicles.$inferSelect | null;

  deal?: typeof schema.deals.$inferSelect | null;

}) {

  const car = {

    plate: appointment.plate || vehicle?.plate || null,

    make: appointment.make || vehicle?.make || null,

    model: appointment.model || vehicle?.model || null,

    vin: appointment.vin || vehicle?.vin || null,

    mileage: appointment.mileage ?? null,

  };

  return {

    ...appointment,

    clientName: client?.name || null,

    clientPhone: client?.phone || appointment.phone || null,

    vehicle: car.plate || car.make || car.model || car.vin ? car : null,

    dealStatus: deal?.status ?? null,

    inSchedule: isAppointmentInSchedule(appointment.status, deal?.status),

  };

}



async function notifyAppointment(

  appointment: typeof schema.serviceAppointments.$inferSelect,

  userId: number,

  vehicle?: { plate?: string | null; make?: string | null; model?: string | null; vin?: string | null } | null,

) {

  const settings = await getSettings();

  if (!settings.notifyWhatsApp && !settings.notifySms) return null;



  const client = appointment.clientId
    ? await getClientInTenant(appointment.clientId)
    : undefined;



  const text = formatAppointmentMessage(appointment, client, vehicle, settings);



  const result = await sendToClientPreferred({
    clientId: appointment.clientId,
    phone: appointment.phone,
    text,
    preferredMessenger: client?.preferredMessenger,
    senderId: userId,
  });

  return result.ok
    ? { ok: true, conversationId: undefined, channel: result.channel }
    : { ok: false, error: result.error };

}



export const service = new Hono()

  .use("*", requireAuth)

  .get("/settings", async (c) => {

    const settings = await getSettings();

    return c.json({ settings }, 200);

  })

  .patch("/settings", async (c) => {
    const userId = c.get("userId") as number;
    const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    const body = await c.req.json();
    const settings = await getSettings();

    const onlyBayCount =
      body.bayCount != null &&
      Object.keys(body).every((k) => k === "bayCount");

    if (user?.role !== "admin" && !onlyBayCount) {
      return c.json({ error: "Только для администратора" }, 403);
    }

    const bayCount = body.bayCount != null
      ? Math.max(1, Math.min(20, Number(body.bayCount) || settings.bayCount || 4))
      : settings.bayCount;

    const [updated] = await db.update(schema.serviceSettings)
      .set({
        shopName: body.shopName ?? settings.shopName,
        address: body.address ?? settings.address,
        phone: body.phone ?? settings.phone,
        notifyWhatsApp: body.notifyWhatsApp ?? settings.notifyWhatsApp,
        notifySms: body.notifySms ?? settings.notifySms,
        bayCount,
        onlineBookingEnabled: body.onlineBookingEnabled ?? settings.onlineBookingEnabled,
        updatedAt: new Date(),
      })
      .where(withTenant(schema.serviceSettings, eq(schema.serviceSettings.id, settings.id)))
      .returning();

    return c.json({ settings: updated }, 200);
  })

  .get("/schedule", async (c) => {

    const schedule = await ensureSchedule();

    const settings = await getSettings();

    return c.json({ schedule, settings }, 200);

  })

  .put("/schedule", requireAdmin, async (c) => {
    const body = await c.req.json();

    const days: any[] = body.days || [];

    const notify = body.notifyWhatsApp !== false;

    const settings = await getSettings();



    await ensureSchedule();

    const updated: typeof schema.serviceSchedule.$inferSelect[] = [];



    for (const d of days) {

      const [row] = await db.update(schema.serviceSchedule)

        .set({

          openTime: d.openTime || "09:00",

          closeTime: d.closeTime || "18:00",

          isClosed: Boolean(d.isClosed),

          note: d.note || null,

          updatedAt: new Date(),

        })

        .where(and(forTenant(schema.serviceSchedule), eq(schema.serviceSchedule.dayOfWeek, d.dayOfWeek)))

        .returning();

      if (row) updated.push(row);

    }



    if (body.settings) {

      await db.update(schema.serviceSettings)

        .set({

          shopName: body.settings.shopName,

          address: body.settings.address,

          phone: body.settings.phone,

          notifyWhatsApp: body.settings.notifyWhatsApp ?? settings.notifyWhatsApp,

          updatedAt: new Date(),

        })

        .where(withTenant(schema.serviceSettings, eq(schema.serviceSettings.id, settings.id)));

    }



    const freshSettings = await getSettings();

    let notifyResult = null;



    if (notify && freshSettings.notifyWhatsApp) {

      const text = formatWeeklySchedule(updated, freshSettings);

      const userId = c.get("userId") as number;

      notifyResult = await broadcastScheduleWhatsApp(text, userId);

    }



    return c.json({ schedule: updated, settings: freshSettings, notifyResult }, 200);

  })

  .get("/appointments", async (c) => {

    const from = c.req.query("from");

    const to = c.req.query("to");

    const scheduleOnly = c.req.query("schedule") === "1";

    let rows = await db

      .select({

        appointment: schema.serviceAppointments,

        client: schema.clients,

        vehicle: schema.vehicles,

        deal: schema.deals,

      })

      .from(schema.serviceAppointments)

      .leftJoin(schema.clients, eq(schema.serviceAppointments.clientId, schema.clients.id))

      .leftJoin(schema.vehicles, eq(schema.serviceAppointments.vehicleId, schema.vehicles.id))

      .leftJoin(schema.deals, eq(schema.serviceAppointments.dealId, schema.deals.id))

      .where(forTenant(schema.serviceAppointments))

      .orderBy(asc(schema.serviceAppointments.scheduledAt));



    if (from) {

      const fromDate = new Date(from);

      rows = rows.filter((r) => r.appointment.scheduledAt >= fromDate);

    }

    if (to) {

      const toDate = new Date(to);

      rows = rows.filter((r) => r.appointment.scheduledAt <= toDate);

    }

    if (scheduleOnly) {

      rows = rows.filter((r) => isAppointmentInSchedule(r.appointment.status, r.deal?.status));

    }

    const user = c.get("user") as { role?: string };
    if (isDemoUser(user)) {
      const demoIds = new Set(await getDemoClientIds());
      rows = rows.filter((r) => r.appointment.clientId != null && demoIds.has(r.appointment.clientId));
    }

    return c.json({

      appointments: rows.map(mapAppointmentRow),

    }, 200);

  })

  .post("/appointments", async (c) => {

    const body = await c.req.json();

    const title = (body.title || "").trim();

    if (!title) return c.json({ error: "Укажите работы / неисправность" }, 400);

    if (!body.scheduledAt) return c.json({ error: "Укажите дату и время" }, 400);



    const scheduledAt = new Date(body.scheduledAt);

    if (Number.isNaN(scheduledAt.getTime())) return c.json({ error: "Некорректная дата" }, 400);



    const car = pickCarFields(body);

    const clientId = body.clientId ? Number(body.clientId) : null;
    if (clientId) {
      const client = await getClientInTenant(clientId);
      if (!client) return c.json({ error: "Клиент не найден" }, 404);
    }
    if (body.dealId) {
      const deal = await getDealInTenant(Number(body.dealId));
      if (!deal) return c.json({ error: "Заказ не найден" }, 404);
    }

    const vehicleId = clientId ? await resolveVehicleId(clientId, body) : null;



    const [appointment] = await db.insert(schema.serviceAppointments).values({

      clientId,

      vehicleId,

      dealId: body.dealId ? Number(body.dealId) : null,

      ...car,

      title,

      scheduledAt,

      durationMin: body.durationMin ? Number(body.durationMin) : 60,

      status: body.status || "scheduled",

      notes: body.notes || null,

      bayNumber: body.bayNumber != null ? Number(body.bayNumber) : null,

      tenantId: tenantId(),

    }).returning();



    let notifyResult = null;

    if (body.notifyWhatsApp !== false) {

      notifyResult = await notifyAppointment(appointment, c.get("userId") as number, {

        plate: car.plate,

        make: car.make,

        model: car.model,

        vin: car.vin,

      });

    }



    return c.json({ appointment, notifyResult }, 201);

  })

  .patch("/appointments/:id", async (c) => {

    const id = parseInt(c.req.param("id"));

    const body = await c.req.json();

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (body.title != null) updates.title = String(body.title).trim();

    if (body.scheduledAt != null) updates.scheduledAt = new Date(body.scheduledAt);

    if (body.durationMin != null) updates.durationMin = Number(body.durationMin);

    if (body.status != null) updates.status = body.status;

    if (body.notes != null) updates.notes = body.notes;

    if (body.clientId != null) updates.clientId = body.clientId ? Number(body.clientId) : null;

    if (body.vehicleId != null) updates.vehicleId = body.vehicleId ? Number(body.vehicleId) : null;

    if (body.phone != null) updates.phone = body.phone || null;

    if (body.plate != null) updates.plate = body.plate || null;

    if (body.make != null) updates.make = body.make || null;

    if (body.model != null) updates.model = body.model || null;

    if (body.vin != null) updates.vin = body.vin || null;

    if (body.mileage != null) updates.mileage = body.mileage === "" ? null : Number(body.mileage) || null;

    if (body.dealId != null) updates.dealId = body.dealId ? Number(body.dealId) : null;
    if (body.bayNumber != null) updates.bayNumber = body.bayNumber === "" ? null : Number(body.bayNumber);
    if (updates.clientId) {
      const client = await getClientInTenant(Number(updates.clientId));
      if (!client) return c.json({ error: "Клиент не найден" }, 404);
    }
    if (updates.dealId) {
      const deal = await getDealInTenant(Number(updates.dealId));
      if (!deal) return c.json({ error: "Заказ не найден" }, 404);
    }

    const [appointment] = await db.update(schema.serviceAppointments)

      .set(updates)

      .where(withTenant(schema.serviceAppointments, eq(schema.serviceAppointments.id, id)))

      .returning();

    if (!appointment) return c.json({ error: "Запись не найдена" }, 404);



    let notifyResult = null;

    if (body.notifyWhatsApp !== false) {

      notifyResult = await notifyAppointment(appointment, c.get("userId") as number, {

        plate: appointment.plate,

        make: appointment.make,

        model: appointment.model,

        vin: appointment.vin,

      });

    }



    return c.json({ appointment, notifyResult }, 200);

  })

  .delete("/appointments/:id", async (c) => {

    const id = parseInt(c.req.param("id"));

    const [appointment] = await db.select().from(schema.serviceAppointments)
      .where(withTenant(schema.serviceAppointments, eq(schema.serviceAppointments.id, id)));

    if (!appointment) return c.json({ error: "Не найдено" }, 404);

    await db.delete(schema.serviceAppointments).where(withTenant(schema.serviceAppointments, eq(schema.serviceAppointments.id, id)));

    return c.json({ ok: true, deleted: id }, 200);

  });

