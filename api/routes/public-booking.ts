import { Hono } from "hono";
import { db } from "../database";
import * as schema from "../database/schema";
import { eq, asc, and, gte, lte } from "drizzle-orm";
import { getTenantBySlug } from "../lib/tenant";
import { runWithTenant } from "../lib/tenant-context";
import { slotsForRange } from "../lib/booking-slots";
import { sendToClientPreferred } from "../lib/client-notify";
import { formatAppointmentMessage } from "../lib/service-format";
import { checkWebhookRateLimit } from "../middleware/security";
import { clientIp } from "../middleware/security";
import { tenantId, forTenant } from "../lib/tenant-query";
import { phonesMatch } from "../lib/phone-normalize";

const publicBooking = new Hono();

async function withTenantSlug(slug: string, fn: () => Promise<Response>) {
  const tenant = await getTenantBySlug(slug);
  if (!tenant?.isActive) {
    return new Response(JSON.stringify({ error: "Сервис не найден" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }
  return runWithTenant({ tenantId: tenant.id, tenantSlug: tenant.slug }, fn);
}

async function getServiceSettings() {
  const [row] = await db.select().from(schema.serviceSettings).where(forTenant(schema.serviceSettings)).limit(1);
  return row;
}

async function getSchedule() {
  return db.select().from(schema.serviceSchedule).orderBy(asc(schema.serviceSchedule.dayOfWeek));
}

publicBooking
  .get("/:slug/booking", async (c) => {
    const slug = c.req.param("slug");
    return withTenantSlug(slug, async () => {
      const settings = await getServiceSettings();
      const onlineEnabled = (settings as { onlineBookingEnabled?: boolean | number | null })?.onlineBookingEnabled;
      if (onlineEnabled === false || onlineEnabled === 0) {
        return c.json({ error: "Онлайн-запись отключена" }, 403);
      }

      const schedule = await getSchedule();
      const bayCount = Number((settings as { bayCount?: number })?.bayCount) || 4;
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from);
      to.setDate(to.getDate() + 14);

      const appts = await db.select().from(schema.serviceAppointments).where(
        and(
          gte(schema.serviceAppointments.scheduledAt, from),
          lte(schema.serviceAppointments.scheduledAt, to),
        ),
      );

      const slots = slotsForRange(
        from,
        14,
        schedule.map((s) => ({
          dayOfWeek: s.dayOfWeek,
          openTime: s.openTime ?? "09:00",
          closeTime: s.closeTime ?? "18:00",
          isClosed: Boolean(s.isClosed),
        })),
        bayCount,
        appts.map((a) => ({
          scheduledAt: a.scheduledAt,
          durationMin: a.durationMin ?? 60,
          bayNumber: (a as { bayNumber?: number | null }).bayNumber ?? null,
          status: a.status ?? "scheduled",
        })),
      );

      return c.json({
        shop: {
          name: settings?.shopName || "СТО",
          address: settings?.address,
          phone: settings?.phone,
        },
        bayCount,
        schedule,
        slots,
      });
    });
  })

  .post("/:slug/booking", async (c) => {
    const ip = clientIp(c);
    const rl = checkWebhookRateLimit(ip);
    if (!rl.ok) {
      return c.json({ error: "Слишком много запросов" }, 429);
    }

    const slug = c.req.param("slug");
    return withTenantSlug(slug, async () => {
      const settings = await getServiceSettings();
      const onlineEnabled = (settings as { onlineBookingEnabled?: boolean | number | null })?.onlineBookingEnabled;
      if (onlineEnabled === false || onlineEnabled === 0) {
        return c.json({ error: "Онлайн-запись отключена" }, 403);
      }

      const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
      const phone = String(body.phone || "").trim();
      const title = String(body.title || body.work || "").trim();
      const name = String(body.name || phone || "Клиент").trim();
      const date = String(body.date || "");
      const time = String(body.time || "");
      const bay = body.bay != null ? Number(body.bay) : null;

      if (!phone || phone.replace(/\D/g, "").length < 10) {
        return c.json({ error: "Укажите корректный телефон" }, 400);
      }
      if (!title) return c.json({ error: "Опишите неисправность или работы" }, 400);
      if (!date || !time) return c.json({ error: "Выберите дату и время" }, 400);

      const scheduledAt = new Date(`${date}T${time}:00`);
      if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) {
        return c.json({ error: "Некорректная дата или время в прошлом" }, 400);
      }

      const normalized = phone.replace(/\D/g, "");
      const allClients = await db.select().from(schema.clients).where(forTenant(schema.clients));
      let client = allClients.find((cl) => cl.phone && (
        cl.phone.replace(/\D/g, "") === normalized
        || phonesMatch(cl.phone, phone)
      ));

      if (!client) {
        const [created] = await db.insert(schema.clients).values({
          name,
          phone,
          source: "online_booking",
          tenantId: tenantId(),
        }).returning();
        client = created;
      }

      const [appointment] = await db.insert(schema.serviceAppointments).values({
        clientId: client.id,
        phone,
        plate: typeof body.plate === "string" ? body.plate.trim() || null : null,
        make: typeof body.make === "string" ? body.make.trim() || null : null,
        model: typeof body.model === "string" ? body.model.trim() || null : null,
        title,
        scheduledAt,
        durationMin: 60,
        status: "scheduled",
        notes: typeof body.notes === "string" ? body.notes.trim() || null : null,
        tenantId: tenantId(),
        bayNumber: bay ?? undefined,
      }).returning();

      const text = formatAppointmentMessage(appointment, client, null, settings);
      const notify = await sendToClientPreferred({
        clientId: client.id,
        phone,
        text: `✅ Запись подтверждена!\n${text}`,
        preferredMessenger: client.preferredMessenger,
      });

      return c.json({
        ok: true,
        appointmentId: appointment.id,
        scheduledAt: appointment.scheduledAt,
        notify,
      }, 201);
    });
  });

export { publicBooking };
