import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { formatFullTime } from "../../lib/utils";
import { money } from "./zn-types";

type Method = "cash" | "card" | "transfer";

type AuditRow = {
  id?: number;
  action?: string;
  detail?: string | null;
  createdAt?: string | number | Date | null;
  created_at?: string | number | Date | null;
  userName?: string | null;
  user_name?: string | null;
};

type Props = {
  dealId: number;
  total: number;
  paid: number;
  balance: number;
  assigneeName: string;
  onChanged: () => void;
};

const METHOD_LABEL: Record<Method, string> = {
  cash: "Наличные",
  card: "Карта",
  transfer: "Безналичный",
};

export function ZnPaymentsTab({ dealId, total, paid, balance, assigneeName, onChanged }: Props) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<Method>("cash");
  const [amount, setAmount] = useState("");
  const [account, setAccount] = useState("Касса");
  const [article, setArticle] = useState("Оплата заказ-наряда");
  const [project, setProject] = useState("Автосервис");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: auditData, refetch: refetchAudit } = useQuery({
    queryKey: ["zn-audit", dealId],
    queryFn: () => apiFetch<{ items: AuditRow[] }>(`/api/sto/deals/${dealId}/audit`),
  });

  const payments = (auditData?.items || []).filter(
    (a) => a.action === "payment" || a.action === "close_with_payment" || a.action === "advance_allocated",
  );

  const openModal = (asAdvance = false) => {
    setAmount(String(balance > 0 ? balance : total || ""));
    setArticle(asAdvance ? "Аванс клиента" : "Оплата заказ-наряда");
    setOpen(true);
  };

  const submit = async () => {
    const paymentAmount = parseFloat(amount.replace(",", ".")) || 0;
    if (paymentAmount <= 0) {
      toast("Укажите сумму платежа", "error");
      return;
    }
    if (!account.trim() || !article.trim() || !project.trim()) {
      toast("Заполните счёт, статью и проект", "error");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/sto/deals/${dealId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentAmount,
          paymentMethod: method,
          note: [note, `Счёт: ${account}`, `Статья: ${article}`, `Проект: ${project}`]
            .filter(Boolean)
            .join(" | "),
        }),
      });
      toast(article === "Аванс клиента" ? "Аванс принят" : "Оплата принята", "success");
      setOpen(false);
      setNote("");
      onChanged();
      refetchAudit();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка оплаты", "error");
    } finally {
      setBusy(false);
    }
  };

  const printReceipt = () => {
    const win = window.open("", "_blank", "noopener,noreferrer,width=480,height=640");
    if (!win) return;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Квитанция ЗН ${dealId}</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;padding:20px;font-size:13px}
h1{font-size:16px} .row{display:flex;justify-content:space-between;margin:6px 0}
.big{font-size:20px;font-weight:700;margin:12px 0}</style></head><body>
<h1>Квитанция об оплате</h1>
<div class="row"><span>Заказ-наряд</span><strong>№ ${dealId}</strong></div>
<div class="row"><span>Сумма документа</span><span>${money(total)}</span></div>
<div class="row"><span>Оплачено</span><span>${money(paid)}</span></div>
<div class="row"><span>Задолженность</span><span>${money(balance)}</span></div>
<div class="big">${balance <= 0 ? "Оплачено полностью" : `К доплате ${money(balance)}`}</div>
<div class="row"><span>Дата</span><span>${new Date().toLocaleString("ru-RU")}</span></div>
<script>setTimeout(()=>print(),200)</script>
</body></html>`);
    win.document.close();
  };

  return (
    <div className="zn-pay">
      <div className="zn-pay__grid">
        <div className="zn-pay__card">
          <div className="zn-muted">Сумма документа</div>
          <div className="zn-wb-total__value">{money(total)}</div>
        </div>
        <div className="zn-pay__card">
          <div className="zn-muted">Оплачено</div>
          <div className="zn-wb-total__value">{money(paid)}</div>
        </div>
        <div className="zn-pay__card">
          <div className="zn-muted">Задолженность</div>
          <div
            className="zn-wb-total__value"
            style={{ color: balance > 0 ? "var(--danger, #e11d48)" : undefined }}
          >
            {money(balance)}
          </div>
        </div>
      </div>

      <div className="zn-pay__actions">
        <button type="button" className="crm-btn crm-btn-primary" onClick={() => openModal(false)}>
          Принять оплату
        </button>
        <button type="button" className="crm-btn" onClick={() => openModal(true)}>
          Аванс клиента
        </button>
        <button type="button" className="crm-btn" onClick={printReceipt}>
          Квитанция
        </button>
      </div>

      <h3 className="zn-pay__history-title">Движение денег по ЗН</h3>
      <table className="zn-table">
        <thead>
          <tr>
            <th>Дата</th>
            <th>Операция</th>
            <th>Детали</th>
            <th>Кто</th>
          </tr>
        </thead>
        <tbody>
          {payments.map((p, idx) => {
            const at = p.createdAt ?? p.created_at;
            return (
            <tr key={p.id || idx}>
              <td>{at ? formatFullTime(at) : "—"}</td>
              <td>
                {p.action === "advance_allocated"
                  ? "Аванс"
                  : p.action === "close_with_payment"
                    ? "Закрытие с оплатой"
                    : "Оплата"}
              </td>
              <td>{p.detail || "—"}</td>
              <td>{p.userName || p.user_name || "—"}</td>
            </tr>
            );
          })}
          {payments.length === 0 && (
            <tr>
              <td colSpan={4} className="zn-muted">
                Платежей пока нет — примите оплату или аванс
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {open && (
        <div className="zn-modal-backdrop" role="dialog" aria-modal="true">
          <div className="zn-modal">
            <div className="zn-modal__head">
              <h2>{article === "Аванс клиента" ? "Аванс клиента" : "Принять оплату"}</h2>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <div className="zn-pay-methods">
              {(
                [
                  ["cash", "Наличные"],
                  ["card", "Карта"],
                  ["transfer", "Безналичный"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`zn-pay-method${method === id ? " is-active" : ""}`}
                  onClick={() => setMethod(id)}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="zn-grid">
              <label className="zn-field">
                <span>К оплате</span>
                <input readOnly value={money(balance)} />
              </label>
              <label className="zn-field">
                <span>Сумма платежа *</span>
                <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" />
              </label>
              <label className="zn-field">
                <span>Счёт *</span>
                <select value={account} onChange={(e) => setAccount(e.target.value)}>
                  <option>Касса</option>
                  <option>Банковский счет</option>
                  <option>Эквайринг</option>
                </select>
              </label>
              <label className="zn-field">
                <span>Статья *</span>
                <select value={article} onChange={(e) => setArticle(e.target.value)}>
                  <option>Оплата заказ-наряда</option>
                  <option>Нераспределенный приход</option>
                  <option>Аванс клиента</option>
                </select>
              </label>
              <label className="zn-field">
                <span>Проект *</span>
                <select value={project} onChange={(e) => setProject(e.target.value)}>
                  <option>Автосервис</option>
                  <option>Запчасти</option>
                </select>
              </label>
              <label className="zn-field">
                <span>Способ</span>
                <input readOnly value={METHOD_LABEL[method]} />
              </label>
              <label className="zn-field">
                <span>Ответственный</span>
                <input readOnly value={assigneeName || "—"} />
              </label>
              <label className="zn-field zn-field--wide">
                <span>Примечание ({note.length}/500)</span>
                <textarea
                  rows={3}
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </div>

            <div className="zn-modal__actions">
              <button type="button" className="crm-btn" onClick={() => setOpen(false)} disabled={busy}>
                Отмена
              </button>
              <button type="button" className="crm-btn crm-btn-primary" onClick={submit} disabled={busy}>
                {busy ? "Сохраняем…" : "Принять"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
