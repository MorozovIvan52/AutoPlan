import { db } from "../database";
import * as schema from "../database/schema";
import { and, eq } from "drizzle-orm";
import { forTenant, tenantId } from "./tenant-query";
import { recalcDealTotals } from "./deal-totals";
import {
  defaultCompanyName,
  deductStockForDocumentStrict,
  nextDocNumber,
  recalcDocumentTotal,
} from "./sales-db";
import { insertSalesItemsFromDeal } from "./sales-from-deal";
import { releaseAllReservesForDeal } from "./stock-reserve";
import { withTenantTransaction } from "./db-transaction";
import type { DbExecutor } from "./db-transaction";

export type PaymentMethod = "cash" | "card" | "transfer";
export type PaymentStatus = "unpaid" | "partial" | "paid";

export class CloseDealError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "CLOSE_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function paymentStatusOf(total: number, paid: number): PaymentStatus {
  if (paid <= 0) return "unpaid";
  if (paid + 0.009 >= total) return "paid";
  return "partial";
}

export function dealDebt(total: number, paid: number): number {
  return Math.max(0, round2(total - paid));
}

export type CloseDealInput = {
  dealId: number;
  userId: number;
  paymentAmount: number;
  paymentMethod: PaymentMethod;
  /** Закрыть ЗН (status=done) при полной оплате. Default true. */
  setStatusDone?: boolean;
  /** Разрешить частичную оплату. Default true. */
  allowPartial?: boolean;
  /** Если false — не ставить done даже при полной оплате. */
  closeDeal?: boolean;
};

export type CloseDealResult = {
  deal: {
    id: number;
    status: string | null;
    paymentStatus: PaymentStatus;
    paidAmount: number;
    amount: number;
  };
  doc: {
    id: number;
    docNumber: string;
    status: string | null;
    totalAmount: number | null;
    paymentAmount: number | null;
  };
  debt: number;
  stock: { deducted: number; skippedNoStockPartId: number };
  reservesReleased: number;
  idempotent?: boolean;
};

async function countReserves(dealId: number, conn: DbExecutor = db): Promise<number> {
  const items = await conn.select({
    id: schema.orderItems.id,
    reservedQty: schema.orderItems.reservedQty,
  }).from(schema.orderItems).where(eq(schema.orderItems.dealId, dealId));
  return items.filter((i) => (i.reservedQty ?? 0) > 0).length;
}

async function executePayment(
  tx: DbExecutor,
  input: CloseDealInput,
  current: typeof schema.deals.$inferSelect,
  total: number,
  alreadyPaid: number,
): Promise<CloseDealResult> {
  const {
    dealId,
    userId,
    paymentMethod,
    paymentAmount,
    setStatusDone = true,
    allowPartial = true,
    closeDeal = true,
  } = input;

  const [client] = current.clientId
    ? await tx.select().from(schema.clients)
      .where(and(forTenant(schema.clients), eq(schema.clients.id, current.clientId)))
      .limit(1)
    : [null];

  const companyName = current.companyName?.trim() || await defaultCompanyName();
  const docNumber = await nextDocNumber("receipt", tx);

  const [doc] = await tx.insert(schema.salesDocuments).values({
    tenantId: tenantId(),
    docType: "receipt",
    docNumber,
    status: "draft",
    clientId: current.clientId,
    dealId: current.id,
    managerId: userId,
    companyName,
    recipientName: client?.name ?? null,
    recipientPhone: client?.phone ?? null,
    paymentMethod,
    paymentAmount,
    totalAmount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  }).returning();

  if (!doc) throw new CloseDealError("Не удалось создать чек", 500);

  const linesCount = await insertSalesItemsFromDeal(doc.id, dealId, tx);
  if (linesCount === 0) {
    throw new CloseDealError("В ЗН нет позиций для чека", 400, "NO_LINES");
  }

  await recalcDocumentTotal(doc.id, tx);

  let stock: { deducted: number; skippedNoStockPartId: number };
  try {
    stock = await deductStockForDocumentStrict(doc.id, tx);
  } catch (e: unknown) {
    if (e instanceof CloseDealError) throw e;
    const err = e as Error & { status?: number; code?: string };
    throw new CloseDealError(err.message || "Ошибка склада", err.status || 409, err.code || "STOCK_ERROR");
  }

  const reservesBefore = await countReserves(dealId, tx);
  await releaseAllReservesForDeal(dealId, tx);

  const [posted] = await tx.update(schema.salesDocuments).set({
    status: "posted",
    paymentAmount,
    paymentMethod,
    postedAt: new Date(),
    updatedAt: new Date(),
  }).where(and(forTenant(schema.salesDocuments), eq(schema.salesDocuments.id, doc.id))).returning();

  const paidAmount = round2(alreadyPaid + paymentAmount);
  const paymentStatus = paymentStatusOf(total, paidAmount);
  const nextStatus =
    paymentStatus === "paid" && closeDeal && setStatusDone
      ? "done"
      : current.status;

  const [updatedDeal] = await tx.update(schema.deals).set({
    paidAmount,
    paymentStatus,
    status: nextStatus,
    updatedAt: new Date(),
  }).where(and(forTenant(schema.deals), eq(schema.deals.id, dealId))).returning();

  return {
    deal: {
      id: updatedDeal!.id,
      status: updatedDeal!.status,
      paymentStatus,
      paidAmount,
      amount: total,
    },
    doc: {
      id: posted!.id,
      docNumber: posted!.docNumber,
      status: posted!.status,
      totalAmount: posted!.totalAmount,
      paymentAmount: posted!.paymentAmount,
    },
    debt: dealDebt(total, paidAmount),
    stock,
    reservesReleased: reservesBefore,
  };
}

/** Закрытие / доплата по ЗН: чек → списание → резерв → payment_status (атомарно). */
export async function closeDealWithPayment(input: CloseDealInput): Promise<CloseDealResult> {
  const {
    dealId,
    paymentMethod,
    setStatusDone = true,
    allowPartial = true,
    closeDeal = true,
  } = input;
  const paymentAmount = round2(Number(input.paymentAmount));

  const [deal] = await db.select().from(schema.deals)
    .where(and(forTenant(schema.deals), eq(schema.deals.id, dealId)))
    .limit(1);
  if (!deal) throw new CloseDealError("ЗН не найден", 404, "NOT_FOUND");

  await recalcDealTotals(dealId);
  const [fresh] = await db.select().from(schema.deals)
    .where(and(forTenant(schema.deals), eq(schema.deals.id, dealId)))
    .limit(1);
  const current = fresh ?? deal;

  const total = round2(Number(current.amount) || 0);
  const alreadyPaid = round2(Number(current.paidAmount) || 0);
  const currentStatus = (current.paymentStatus as PaymentStatus) || paymentStatusOf(total, alreadyPaid);

  if (currentStatus === "paid" || (total > 0 && alreadyPaid + 0.009 >= total)) {
    return {
      deal: {
        id: current.id,
        status: current.status,
        paymentStatus: "paid",
        paidAmount: alreadyPaid,
        amount: total,
      },
      doc: { id: 0, docNumber: "", status: "posted", totalAmount: total, paymentAmount: alreadyPaid },
      debt: 0,
      stock: { deducted: 0, skippedNoStockPartId: 0 },
      reservesReleased: 0,
      idempotent: true,
    };
  }

  if (!(paymentAmount > 0)) {
    throw new CloseDealError("Укажите сумму оплаты больше 0", 400, "BAD_AMOUNT");
  }

  const debtBefore = dealDebt(total, alreadyPaid);
  if (total <= 0) {
    throw new CloseDealError("Сумма ЗН равна нулю — добавьте работы или запчасти", 400, "ZERO_TOTAL");
  }
  if (paymentAmount > debtBefore + 0.009) {
    throw new CloseDealError(`Сумма оплаты (${paymentAmount}) больше долга (${debtBefore})`, 400, "OVERPAY");
  }
  if (!allowPartial && paymentAmount + 0.009 < debtBefore) {
    throw new CloseDealError("Частичная оплата запрещена для этого запроса", 400, "PARTIAL_FORBIDDEN");
  }

  return withTenantTransaction((tx) =>
    executePayment(tx, { ...input, paymentAmount, paymentMethod, setStatusDone, allowPartial, closeDeal }, current, total, alreadyPaid),
  );
}
