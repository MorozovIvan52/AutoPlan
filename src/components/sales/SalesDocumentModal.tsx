import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { ArticleAutocompleteInput } from "../ArticleAutocompleteInput";
import { ClientSearchSelect } from "../ClientSearchSelect";
import {
  formatDocDate,
  formatMoney,
  lineTotal,
  postedToastText,
  salesDocStatusClass,
  salesDocStatusLabel,
  salesDocTypeLabel,
  type SalesDocument,
  type SalesDocumentItem,
} from "../../lib/sales-documents";
import { mergeWarrantyTemplates } from "../../lib/warranty-templates";
import { printSalesDocument } from "./SalesPrintView";

type Props = {
  documentId: number;
  onClose: () => void;
  onChanged?: () => void;
};

export function SalesDocumentModal({ documentId, onClose, onChanged }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [recipientName, setRecipientName] = useState("");
  const [recipientPhone, setRecipientPhone] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [notes, setNotes] = useState("");
  const [warrantyText, setWarrantyText] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [newArticle, setNewArticle] = useState("");
  const [newName, setNewName] = useState("");
  const [newBrand, setNewBrand] = useState("");
  const [newQty, setNewQty] = useState("1");
  const [newPrice, setNewPrice] = useState("");
  const [newStockPartId, setNewStockPartId] = useState<number | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sales-doc", documentId],
    queryFn: () =>
      apiFetch<{
        doc: SalesDocument;
        items: SalesDocumentItem[];
        client?: { id: number; name: string; phone?: string | null } | null;
        manager?: { id: number; name: string } | null;
      }>(`/api/sales/${documentId}`),
  });

  const { data: settingsData } = useQuery({
    queryKey: ["crm-settings"],
    queryFn: () =>
      apiFetch<{
        settings: {
          companyName?: string | null;
          companyInn?: string | null;
          companyAddress?: string | null;
          companyPhone?: string | null;
          warrantyTemplates?: string | null;
          receiptShowArticles?: boolean | null;
        };
      }>("/api/crm-settings"),
  });

  const doc = data?.doc;
  const items = data?.items || [];
  const isDraft = doc?.status === "draft";
  const isReceipt = doc?.docType === "receipt";
  const showArticles = settingsData?.settings?.receiptShowArticles !== false;
  const warrantyTemplates = useMemo(
    () => mergeWarrantyTemplates(settingsData?.settings?.warrantyTemplates),
    [settingsData?.settings?.warrantyTemplates],
  );

  useEffect(() => {
    if (!doc) return;
    setRecipientName(doc.recipientName || "");
    setRecipientPhone(doc.recipientPhone || "");
    setClientId(doc.clientId ?? null);
    setNotes(doc.notes || "");
    setWarrantyText(doc.warrantyText || "");
    setPaymentMethod(doc.paymentMethod || "cash");
  }, [doc?.id, doc?.updatedAt]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sales/${documentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          recipientName,
          recipientPhone,
          notes,
          warrantyText,
          paymentMethod,
        }),
      }),
    onSuccess: () => {
      refetch();
      onChanged?.();
      toast("Сохранено", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const addItemMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/sales/${documentId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stockPartId: newStockPartId,
          article: newArticle || null,
          brand: newBrand || null,
          name: newName,
          qty: parseInt(newQty, 10) || 1,
          price: newPrice ? parseFloat(newPrice) : null,
        }),
      }),
    onSuccess: () => {
      setNewArticle("");
      setNewName("");
      setNewBrand("");
      setNewQty("1");
      setNewPrice("");
      setNewStockPartId(null);
      refetch();
      onChanged?.();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const updateItemMutation = useMutation({
    mutationFn: ({ itemId, patch }: { itemId: number; patch: Record<string, unknown> }) =>
      apiFetch(`/api/sales/${documentId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }),
    onSuccess: () => {
      refetch();
      onChanged?.();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: number) => apiFetchVoid(`/api/sales/${documentId}/items/${itemId}`, { method: "DELETE" }),
    onSuccess: () => {
      refetch();
      onChanged?.();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const postMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ doc: SalesDocument; items: SalesDocumentItem[]; manager?: { name?: string }; integrations?: unknown }>(
        `/api/sales/${documentId}/post`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paymentMethod }),
        },
      ),
    onSuccess: (res) => {
      const msg = postedToastText(res.integrations as Parameters<typeof postedToastText>[0]);
      toast(msg.text, msg.type);
      refetch();
      qc.invalidateQueries({ queryKey: ["sales-docs"] });
      onChanged?.();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/api/sales/${documentId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      toast("Проведение отменено", "info");
      refetch();
      onChanged?.();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetchVoid(`/api/sales/${documentId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast("Документ удалён", "info");
      qc.invalidateQueries({ queryKey: ["sales-docs"] });
      onChanged?.();
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const total = items.reduce((sum, row) => sum + lineTotal(row.qty, row.price), 0);

  const handlePrint = () => {
    if (!doc) return;
    printSalesDocument({
      doc,
      items,
      manager: data?.manager,
      company: settingsData?.settings,
      printVariant: isReceipt ? "receipt" : "default",
      showArticles: isReceipt ? showArticles : true,
    });
  };

  if (isLoading || !doc) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal sales-doc-modal sales-doc-modal--wide" onClick={(e) => e.stopPropagation()}>
          <div className="modal__body" style={{ padding: 40, textAlign: "center", color: "var(--text-muted)" }}>
            Загрузка…
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sales-doc-modal sales-doc-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head sales-doc-head">
          <div>
            <div className="sales-doc-head__title">
              <h2 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>
                {salesDocTypeLabel(doc.docType)} № {doc.docNumber}
              </h2>
              <span className={salesDocStatusClass(doc.status)}>{salesDocStatusLabel(doc.status)}</span>
            </div>
            <p className="sales-doc-head__meta">
              {formatDocDate(doc.createdAt)}
              {" · "}
              {isReceipt ? "быстрая продажа со склада" : "отгрузка с получателем"}
            </p>
          </div>
          <div className="sales-doc-head__actions">
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={handlePrint}>
              Печать
            </button>
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>

        <div className="modal__body sales-doc-body">
          <div className="sales-doc-layout">
            <div className="sales-doc-main">
              <div className="sales-doc-section">
                <div className="sales-doc-section__head">
                  <h3>Клиент и получатель</h3>
                  <span>{isReceipt ? "Получатель необязателен" : "Получатель обязателен"}</span>
                </div>
                <div className="sales-doc-grid">
                  <div className="sales-doc-grid__full">
                    <label style={{ fontSize: 12, color: "var(--text-muted)", display: "block", marginBottom: 6 }}>
                      {isReceipt ? "Покупатель" : "Получатель"}
                    </label>
                    <ClientSearchSelect
                      value={clientId}
                      onChange={(id, client) => {
                        setClientId(id);
                        if (client) {
                          setRecipientName(client.name);
                          setRecipientPhone(client.phone || "");
                        }
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Имя получателя</label>
                    <input
                      className="crm-input"
                      value={recipientName}
                      disabled={!isDraft}
                      onChange={(e) => setRecipientName(e.target.value)}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Телефон</label>
                    <input
                      className="crm-input"
                      value={recipientPhone}
                      disabled={!isDraft}
                      onChange={(e) => setRecipientPhone(e.target.value)}
                    />
                  </div>
                  <div className="sales-doc-grid__full">
                    <label style={{ fontSize: 12, color: "var(--text-muted)" }}>Примечание</label>
                    <textarea
                      className="crm-input"
                      rows={2}
                      value={notes}
                      disabled={!isDraft}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="sales-doc-section">
                <div className="sales-doc-section__head">
                  <h3>Позиции</h3>
                  <span>{items.length} шт.</span>
                </div>
                <table className="data-table">
                  <thead>
                    <tr>
                      {showArticles && <th>Артикул</th>}
                      <th>Наименование</th>
                      <th>Кол-во</th>
                      <th>Цена</th>
                      <th>Сумма</th>
                      {isDraft && <th />}
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item.id}>
                        {showArticles && <td style={{ fontFamily: "monospace" }}>{item.article || "—"}</td>}
                        <td>{item.brand ? `${item.brand} · ${item.name}` : item.name}</td>
                        <td>
                          {isDraft ? (
                            <input
                              className="crm-input"
                              style={{ width: 64, height: 30 }}
                              type="number"
                              min={1}
                              defaultValue={item.qty ?? 1}
                              onBlur={(e) => {
                                const qty = Math.max(1, parseInt(e.target.value, 10) || 1);
                                if (qty !== item.qty) updateItemMutation.mutate({ itemId: item.id!, patch: { qty } });
                              }}
                            />
                          ) : (
                            item.qty ?? 1
                          )}
                        </td>
                        <td>
                          {isDraft ? (
                            <input
                              className="crm-input"
                              style={{ width: 90, height: 30 }}
                              type="number"
                              min={0}
                              step="0.01"
                              defaultValue={item.price ?? 0}
                              onBlur={(e) => {
                                const price = parseFloat(e.target.value) || 0;
                                if (price !== item.price) updateItemMutation.mutate({ itemId: item.id!, patch: { price } });
                              }}
                            />
                          ) : (
                            formatMoney(item.price)
                          )}
                        </td>
                        <td>{formatMoney(lineTotal(item.qty, item.price))}</td>
                        {isDraft && (
                          <td>
                            <button
                              type="button"
                              className="crm-btn crm-btn-ghost crm-btn-sm"
                              onClick={() => deleteItemMutation.mutate(item.id!)}
                            >
                              ✕
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>

                {isDraft && (
                  <div style={{ marginTop: 12, display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
                    <ArticleAutocompleteInput
                      value={newArticle}
                      onChange={setNewArticle}
                      onSelect={(part) => {
                        setNewStockPartId(part.id);
                        setNewArticle(part.article || "");
                        setNewBrand(part.brand || "");
                        setNewName(part.name);
                        setNewPrice(part.price != null ? String(part.price) : "");
                      }}
                      placeholder="Артикул"
                    />
                    <input className="crm-input" placeholder="Бренд" value={newBrand} onChange={(e) => setNewBrand(e.target.value)} />
                    <input className="crm-input" placeholder="Название *" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ gridColumn: "span 2" }} />
                    <input className="crm-input" placeholder="Кол-во" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
                    <input className="crm-input" placeholder="Цена" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} />
                    <button
                      type="button"
                      className="crm-btn crm-btn-sm"
                      onClick={() => newName.trim() && addItemMutation.mutate()}
                    >
                      + Позиция
                    </button>
                  </div>
                )}
              </div>

              {isReceipt && (
                <div className="sales-doc-section">
                  <div className="sales-doc-section__head">
                    <h3>Гарантия</h3>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {warrantyTemplates.map((tpl) => (
                      <button
                        key={tpl.id}
                        type="button"
                        className="chip"
                        disabled={!isDraft}
                        onClick={() => setWarrantyText(tpl.text)}
                      >
                        {tpl.title}
                      </button>
                    ))}
                  </div>
                  <textarea
                    className="crm-input"
                    rows={3}
                    value={warrantyText}
                    disabled={!isDraft}
                    onChange={(e) => setWarrantyText(e.target.value)}
                  />
                </div>
              )}
            </div>

            <aside className="sales-doc-aside">
              <div className="sales-doc-aside__total">
                <span>Итого</span>
                <strong>{formatMoney(doc.totalAmount ?? total)}</strong>
              </div>
              {isReceipt && isDraft && (
                <div className="pos-pay-tabs" style={{ marginTop: 12 }}>
                  {(["cash", "card", "transfer"] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      className={`pos-pay-tab${paymentMethod === method ? " pos-pay-tab--on" : ""}`}
                      onClick={() => setPaymentMethod(method)}
                    >
                      {method === "cash" ? "Нал" : method === "card" ? "Карта" : "Перевод"}
                    </button>
                  ))}
                </div>
              )}
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12, lineHeight: 1.5 }}>
                {isReceipt
                  ? "Товарный чек удобен для быстрой продажи в магазине."
                  : "Расходная накладная нужна, когда важен получатель и отгрузка."}
              </p>
            </aside>
          </div>
        </div>

        <div className="modal__foot sales-doc-foot">
          {(doc.status === "draft" || doc.status === "cancelled") && (
            <button
              type="button"
              className="crm-btn crm-btn-ghost"
              onClick={() => {
                const msg = doc.status === "cancelled" ? "Удалить отменённый документ?" : "Удалить черновик?";
                if (window.confirm(msg)) deleteMutation.mutate();
              }}
            >
              Удалить
            </button>
          )}
          {isDraft && (
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              Сохранить
            </button>
          )}
          {doc.status === "posted" && (
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}>
              Отменить проведение
            </button>
          )}
          {isDraft && (
            <button
              type="button"
              className="crm-btn"
              disabled={!items.length || postMutation.isPending || saveMutation.isPending}
              onClick={async () => {
                try {
                  await saveMutation.mutateAsync();
                  postMutation.mutate();
                } catch {
                  /* toast from mutation */
                }
              }}
            >
              {postMutation.isPending ? "Проведение…" : "Провести и принять оплату"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
