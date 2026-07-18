export type CdekShipmentPhase = "created" | "accepted" | "in_transit" | "at_pvz" | "delivered" | "unknown";

export type CdekStatusEntry = { code?: string; name?: string; date_time?: string };

/** Последний статус из истории СДЭК (по date_time) */
export function pickLatestCdekStatus(
  statuses: CdekStatusEntry[] | null | undefined,
): { code: string; name: string; raw: string } | null {
  if (!statuses?.length) return null;
  const sorted = [...statuses].sort((a, b) => {
    const ta = a.date_time ? new Date(a.date_time).getTime() : 0;
    const tb = b.date_time ? new Date(b.date_time).getTime() : 0;
    return tb - ta;
  });
  const s = sorted[0];
  const code = (s.code || "").trim();
  const name = (s.name || "").trim();
  const raw = name || code;
  return raw ? { code, name, raw } : null;
}

const PHASE_BY_CODE: Record<string, CdekShipmentPhase> = {
  CREATED: "created",
  REMOVED: "unknown",
  ACCEPTED: "accepted",
  RECEIVED_AT_SHIPMENT_WAREHOUSE: "accepted",
  READY_TO_SHIP_AT_SENDING_OFFICE: "accepted",
  READY_FOR_SHIPMENT_IN_SENDER_CITY: "accepted",
  DELIVERED_SENDER_CITY_CDEK: "accepted",
  RETURNED_TO_SENDER_WAREHOUSE: "accepted",
  RETURNED_TO_RECIPIENT_CITY_WAREHOUSE: "accepted",

  PASSED_TO_CARRIER_AT_SENDING_OFFICE: "in_transit",
  SEND_TO_TRANSIT_OFFICE: "in_transit",
  MET_AT_TRANSIT_OFFICE: "in_transit",
  ACCEPTED_TO_OFFICE_TRANSIT_WAREHOUSE: "in_transit",
  ENTERED_TO_OFFICE_TRANSIT_WAREHOUSE: "in_transit",
  RETURNED_TO_TRANSIT_WAREHOUSE: "in_transit",
  READY_TO_SHIP_IN_TRANSIT_OFFICE: "in_transit",
  PASSED_TO_CARRIER_AT_TRANSIT_OFFICE: "in_transit",
  SEND_TO_SENDING_OFFICE: "in_transit",
  SEND_TO_RECIPIENT_OFFICE: "in_transit",
  MET_AT_SENDING_OFFICE: "in_transit",
  MET_AT_RECIPIENT_OFFICE: "in_transit",
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: "in_transit",
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CIT: "in_transit",
  SENT_TO_TRANSIT_CITY: "in_transit",
  SENT_TO_TRANSIT_CIT: "in_transit",
  ACCEPTED_IN_TRANSIT_CITY: "in_transit",
  ACCEPTED_IN_TRANSIT_CIT: "in_transit",
  ACCEPTED_AT_TRANSIT_WAREHOUSE: "in_transit",
  ACCEPTED_AT_TRANSIT_WAREHOUS: "in_transit",
  TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY: "in_transit",
  SENT_TO_RECIPIENT_CITY: "in_transit",
  ACCEPTED_IN_RECIPIENT_CITY: "in_transit",
  ACCEPTED_AT_DELIVERY_WAREHOUSE: "in_transit",
  ENTERED_TO_DELIVERY_WAREHOUSE: "in_transit",
  ACCEPTED_AT_WAREHOUSE_ON_DEMAND: "in_transit",
  ENTERED_TO_WAREHOUSE_ON_DEMAND: "in_transit",
  ISSUED_FOR_DELIVERY: "in_transit",
  RETURNED_TO_DELIVERY_WAREHOUSE: "in_transit",
  TAKEN_BY_COURIER: "in_transit",
  IN_CUSTOMS_INTERNATIONAL: "in_transit",
  SHIPPED_TO_DESTINATION: "in_transit",
  PASSED_TO_TRANSIT_CARRIER: "in_transit",
  IN_CUSTOMS_LOCAL: "in_transit",
  CUSTOMS_COMPLETE: "in_transit",
  ARRIVED_AT_TRANSIT_CITY: "in_transit",
  ARRIVED_AT_RECIPIENT_CITY: "in_transit",

  READY_FOR_PICKUP: "at_pvz",
  READY_FOR_PICKUP_IN_RECIPIENT_CITY: "at_pvz",
  READY_FOR_RECIPIENT_CITY_DELIVERY: "at_pvz",
  ACCEPTED_AT_PICK_UP_POINT: "at_pvz",
  ACCEPTED_AT_PICKUP_POINT: "at_pvz",
  POSTOMAT_POSTED: "at_pvz",
  POSTOMAT_RECEIVED: "at_pvz",
  READY_FOR_RECEIPT: "at_pvz",

  DELIVERED: "delivered",
  CONVEYANCE_COMPLETED: "delivered",
  NOT_DELIVERED: "unknown",
  POSTOMAT_SEIZED: "unknown",
};

const LABEL_BY_CODE: Record<string, string> = {
  CREATED: "Создана накладная",
  ACCEPTED: "Сдан / принят СДЭК",
  RECEIVED_AT_SHIPMENT_WAREHOUSE: "Сдан на склад СДЭК",
  READY_FOR_SHIPMENT_IN_SENDER_CITY: "Сдан, готов к отправке",
  TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY: "В пути",
  SENT_TO_TRANSIT_CITY: "В пути (транзит)",
  SENT_TO_RECIPIENT_CITY: "В пути в город получателя",
  ACCEPTED_IN_RECIPIENT_CITY: "В пути, прибыл в город",
  ACCEPTED_AT_PICK_UP_POINT: "Готов к выдаче",
  READY_FOR_PICKUP: "Готов к выдаче",
  READY_FOR_RECIPIENT_CITY_DELIVERY: "Готов к выдаче",
  POSTOMAT_RECEIVED: "Готов к выдаче (постамат)",
  DELIVERED: "Вручено",
  NOT_DELIVERED: "Не вручено",
};

function normalizeCode(status: string): string {
  return status.trim().toUpperCase().replace(/\s+/g, "_");
}

function phaseFromRussianText(status: string): CdekShipmentPhase | null {
  const s = status.toLowerCase();
  if (s.includes("вручен") || s.includes("доставлен получателю")) return "delivered";
  if (s.includes("готов к выдаче") || s.includes("поступил в пвз") || s.includes("поступил в пункт")
    || s.includes("пункт выдачи") || s.includes("постамат")) return "at_pvz";
  if (s.includes("в пути") || s.includes("транзит") || s.includes("отправлен") || s.includes("прибыл в город")) {
    return "in_transit";
  }
  if (s.includes("сдан") || s.includes("принят") || s.includes("на складе отправителя") || s.includes("создан")) {
    if (s.includes("создан")) return "created";
    return "accepted";
  }
  return null;
}

export function cdekShipmentPhase(status: string | null | undefined): CdekShipmentPhase {
  if (!status?.trim()) return "created";

  const code = normalizeCode(status);
  if (PHASE_BY_CODE[code]) return PHASE_BY_CODE[code];

  const u = code;
  if (u.includes("DELIVERED") && !u.includes("NOT_DELIVERED")) return "delivered";
  if (u.includes("READY_FOR_PICKUP") || u.includes("PICK_UP_POINT") || u.includes("PICKUP_POINT") || u.includes("POSTOMAT")) {
    return "at_pvz";
  }
  if (u.includes("CREATED")) return "created";
  if (u.includes("ACCEPTED") || u.includes("RECEIVED_AT_SHIPMENT") || u.includes("READY_FOR_SHIPMENT_IN_SENDER")) {
    return "accepted";
  }
  if (u.includes("TRANSIT") || u.includes("SENT_TO") || u.includes("TAKEN_BY") || u.includes("COURIER")
    || u.includes("WAREHOUSE") || u.includes("CUSTOMS")) {
    return "in_transit";
  }

  const fromRu = phaseFromRussianText(status);
  if (fromRu) return fromRu;

  return "unknown";
}

export function cdekPhaseLabel(phase: CdekShipmentPhase): string {
  const map: Record<CdekShipmentPhase, string> = {
    created: "Создана",
    accepted: "Сдан / принят",
    in_transit: "В пути",
    at_pvz: "Готов к выдаче",
    delivered: "Вручено",
    unknown: "Уточняется",
  };
  return map[phase];
}

/** Человекочитаемый статус для UI */
export function cdekStatusDisplayLabel(status: string | null | undefined): string {
  if (!status?.trim()) return "Ожидает данные СДЭК";

  const code = normalizeCode(status);
  if (LABEL_BY_CODE[code]) return LABEL_BY_CODE[code];

  if (/[а-яё]/i.test(status)) return status;

  const phase = cdekShipmentPhase(status);
  return cdekPhaseLabel(phase);
}

export function cdekTrackingUrl(trackNumber: string): string {
  return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(trackNumber)}`;
}

export function cdekIsErrorStatus(status: string | null | undefined): boolean {
  if (!status?.trim()) return false;
  const s = status.toLowerCase();
  return s.includes("некоррект") || s.includes("ошибк") || s.includes("отклон")
    || s.includes("invalid") || s.includes("not_delivered");
}

export function cdekStatusHint(
  status: string | null | undefined,
  errorMessage?: string | null,
): string | null {
  if (errorMessage?.trim()) return errorMessage.trim();
  if (!cdekIsErrorStatus(status)) return null;
  return "СДЭК не принял заявку. Нажмите «Создать ещё заявку» — будет пересоздана с тем же № ИМ из заказа. Если ошибка повторится, проверьте телефон, ПВЗ, габариты и сумму наложенного платежа.";
}
