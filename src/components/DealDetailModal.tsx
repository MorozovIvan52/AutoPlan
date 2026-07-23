import { useState, useCallback } from "react";
import { useFormSync } from "../lib/use-form-sync";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiFetch } from "../lib/fetch-api";
import { dealStatusLabel, orderTypeLabel, formatFullTime } from "../lib/utils";
import { useToast } from "../lib/toast";
import { CdekShipping } from "./CdekShipping";
const STATUSES = [
  "new",
  "quoted",
  "in_progress",
  "ready",
  "shipped",
  "done",
  "cancelled",
] as const;
type Props = { dealId: number; onClose: () => void };
export function DealDetailModal({ dealId, onClose }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [vin, setVin] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("new");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["deal", dealId],
    queryFn: () =>
      apiFetch<{
        deal: any;
        client: any;
        items: any[];
        conversationId: number | null;
        assignee: { id: number; name: string } | null;
      }>(`/api/deals/${dealId}`),
  });
  const syncFromDeal = useCallback(() => {
    const d = data?.deal;
    if (!d) return;
    setTitle(d.title || "");
    setAmount(d.amount != null ? String(d.amount) : "");
    setVin(d.vin || "");
    setDescription(d.description || "");
    setStatus(d.status || "new");
  }, [data?.deal]);
  useFormSync(data?.deal?.id ?? null, syncFromDeal);
  const saveMutation = useMutation({
    mutationFn: async () => {
      const parsedAmount = amount.trim()
        ? parseFloat(amount.replace(",", "."))
        : null;
      return apiFetch(`/api/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          amount:
            parsedAmount != null && !Number.isNaN(parsedAmount)
              ? parsedAmount
              : null,
          vin: vin.trim() || null,
          description: description.trim() || null,
          status,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["deals-all"] });
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
      toast("Заказ сохранён", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });
  const deal = data?.deal;
  const client = data?.client;
  const items = data?.items || [];
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal deal-detail-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal__head">
          <div>
            <strong>Заказ #{dealId}</strong>
            {deal && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  marginTop: 2,
                }}
              >
                {formatFullTime(deal.updatedAt || deal.createdAt)}
              </div>
            )}
          </div>
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-icon"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <div
          className="modal__body"
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          {isLoading ? (
            <p style={{ color: "var(--text-muted)" }}>Загрузка...</p>
          ) : isError || !deal ? (
            <p style={{ color: "var(--danger)" }}>
              Не удалось загрузить заказ
            </p>
          ) : (
            <>
              <div className="deal-detail-client">
                <div style={{ fontWeight: 600 }}>
                  {client?.name || "Клиент"}
                </div>
                {client?.phone && (
                  <div style={{ fontSize: 12, color: "var(--accent)" }}>
                    {client.phone}
                  </div>
                )}
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    marginTop: 8,
                    flexWrap: "wrap",
                  }}
                >
                  {data.conversationId && (
                    <button
                      type="button"
                      className="crm-btn crm-btn-ghost crm-btn-sm"
                      onClick={() => {
                        onClose();
                        setLocation(`/?conv=${data.conversationId}`);
                      }}
                    >
                      Открыть чат
                    </button>
                  )}
                  <span className="chip active" style={{ fontSize: 10 }}>
                    {orderTypeLabel(deal.orderType)}
                  </span>
                  {deal.avitoItemId && (
                    <span style={{ fontSize: 11, color: "#00aaff" }}>
                      Авито
                    </span>
                  )}
                </div>
              </div>
              <label className="deal-field">
                <span>Название</span>
                <input
                  className="crm-input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 10,
                }}
              >
                <label className="deal-field">
                  <span>Сумма ₽</span>
                  <input
                    className="crm-input"
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </label>
                <label className="deal-field">
                  <span>VIN</span>
                  <input
                    className="crm-input"
                    value={vin}
                    onChange={(e) => setVin(e.target.value)}
                    placeholder="XW8..."
                  />
                </label>
              </div>
              <label className="deal-field">
                <span>Статус</span>
                <select
                  className="crm-input"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {dealStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="deal-field">
                <span>Описание</span>
                <textarea
                  className="crm-input"
                  rows={3}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  style={{ resize: "vertical" }}
                />
              </label>
              {deal.avitoItemTitle && (
                <div className="deal-detail-block">
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginBottom: 4,
                    }}
                  >
                    Объявление Авито
                  </div>
                  <div style={{ fontSize: 13 }}>{deal.avitoItemTitle}</div>
                  {deal.avitoPrice != null && (
                    <div
                      style={{
                        color: "var(--success)",
                        fontWeight: 600,
                        marginTop: 4,
                      }}
                    >
                      {Number(deal.avitoPrice).toLocaleString("ru-RU")} ₽
                    </div>
                  )}
                </div>
              )}
              {items.length > 0 && (
                <div className="deal-detail-block">
                  <div
                    style={{
                      fontSize: 11,
                      color: "var(--text-muted)",
                      marginBottom: 8,
                    }}
                  >
                    Позиции заказа
                  </div>
                  {items.map((item) => (
                    <div key={item.id} className="deal-item-row">
                      <span>{item.name}</span>
                      <span style={{ color: "var(--text-muted)" }}>
                        {item.qty} × {item.price?.toLocaleString("ru-RU")} ₽
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {deal.orderType === "parts" && client && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <CdekShipping
                    dealId={dealId}
                    deal={deal}
                    client={client}
                    items={items}
                  />
                </div>
              )}
              {data.assignee && (
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                  Ответственный: {data.assignee.name}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal__foot">
          <button
            type="button"
            className="crm-btn crm-btn-ghost"
            onClick={onClose}
          >
            Закрыть
          </button>
          <button
            type="button"
            className="crm-btn"
            disabled={saveMutation.isPending || !title.trim()}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? "Сохранение..." : "Сохранить"}
          </button>
        </div>
      </div>
    </div>
  );
}
