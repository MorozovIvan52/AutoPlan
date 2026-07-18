import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and, isNotNull, ne, isNull } from "drizzle-orm";
import { getCdekSettings, isCdekConfigured, getCdekOrderByUuid, getCdekOrderByNumber } from "../lib/cdek";
import { pickLatestCdekStatus } from "../lib/cdek-status";
import { notifyUser } from "../lib/notify";

const PICKUP_STATUS_MARKERS = [
  "READY_FOR_PICKUP",
  "ACCEPTED_AT_PICK_UP_POINT",
  "ACCEPTED_AT_PICKUP_POINT",
  "POSTOMAT_RECEIVED",
  "READY_FOR_RECEIPT",
  "Вручен",
  "Принят на склад доставки",
  "Поступил в пункт выдачи",
  "Поступил в ПВЗ",
];

let timer: ReturnType<typeof setInterval> | null = null;

function isPickupArrived(status: string | null | undefined): boolean {
  if (!status) return false;
  const u = status.toUpperCase();
  return PICKUP_STATUS_MARKERS.some((m) => u.includes(m.toUpperCase()) || status.includes(m));
}

export async function notifyCdekArrivalIfNeeded(
  deal: typeof schema.deals.$inferSelect,
  status: string | null | undefined,
) {
  if (!isPickupArrived(status) || deal.cdekArrivalNotifiedAt) return false;

  const [client] = await db.select().from(schema.clients).where(eq(schema.clients.id, deal.clientId));
  const pvz = deal.cdekPvzAddress || "ПВЗ СДЭК";
  const title = `📦 СДЭК: груз в ПВЗ — ${client?.name || "клиент"}`;
  const text = [
    `Заказ #${deal.id}: ${deal.title}`,
    client?.phone ? `Тел: ${client.phone}` : "",
    `Трек: ${deal.cdekTrackNumber || "—"}`,
    `Статус: ${status}`,
    `ПВЗ: ${pvz}`,
    "Позвоните клиенту — посылка ждёт в пункте выдачи.",
  ].filter(Boolean).join("\n");

  const operators = await db.select().from(schema.users).where(eq(schema.users.isActive, true));
  for (const op of operators) {
    await notifyUser({
      userId: op.id,
      type: "deal_updated",
      title,
      text,
      link: `/deals?deal=${deal.id}`,
    });
  }

  await db.update(schema.deals)
    .set({ cdekArrivalNotifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.deals.id, deal.id));

  console.log(`[cdek-poll] уведомление ПВЗ: заказ #${deal.id}`);
  return true;
}

async function pollDeal(deal: typeof schema.deals.$inferSelect) {
  const settings = await getCdekSettings();
  if (!isCdekConfigured(settings)) return;

  let entity = null;
  if (deal.cdekOrderUuid) {
    entity = await getCdekOrderByUuid(settings, deal.cdekOrderUuid).catch(() => null);
  }
  if (!entity && deal.cdekTrackNumber) {
    entity = await getCdekOrderByNumber(settings, deal.cdekTrackNumber).catch(() => null);
  }
  if (!entity) return;

  const trackNumber = entity.cdek_number || deal.cdekTrackNumber;
  const latest = pickLatestCdekStatus(entity.statuses);
  const status = latest?.raw || deal.cdekStatus;

  if (trackNumber !== deal.cdekTrackNumber || status !== deal.cdekStatus) {
    await db.update(schema.deals).set({
      cdekTrackNumber: trackNumber,
      cdekStatus: status,
      cdekOrderUuid: entity.uuid || deal.cdekOrderUuid,
      updatedAt: new Date(),
    }).where(eq(schema.deals.id, deal.id));
  }

  const updatedDeal = { ...deal, cdekTrackNumber: trackNumber || deal.cdekTrackNumber, cdekStatus: status };
  await notifyCdekArrivalIfNeeded(updatedDeal, status);
}

export function startCdekPolling() {
  if (timer) return;
  if (process.env.CDEK_POLL_ENABLED === "false") return;

  const tick = async () => {
    try {
      const deals = await db.select().from(schema.deals).where(and(
        isNotNull(schema.deals.cdekOrderUuid),
        ne(schema.deals.status, "cancelled"),
        ne(schema.deals.status, "done"),
        isNull(schema.deals.cdekArrivalNotifiedAt),
      ));

      for (const deal of deals) {
        try {
          await pollDeal(deal);
        } catch (e: any) {
          console.error(`[cdek-poll] заказ #${deal.id}:`, e.message);
        }
      }
    } catch (e) {
      console.error("[cdek-poll] ошибка:", e);
    }
  };

  tick();
  const intervalMin = Number(process.env.CDEK_POLL_INTERVAL_MINUTES) || 15;
  timer = setInterval(tick, intervalMin * 60 * 1000);
  console.log(`[cdek-poll] проверка статусов СДЭК каждые ${intervalMin} мин`);
}
