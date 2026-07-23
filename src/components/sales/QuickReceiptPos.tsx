import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { ClientSearchSelect } from "../ClientSearchSelect";
import { SearchNotFoundCreate } from "../SearchNotFoundCreate";
import {
  formatMoney,
  lineTotal,
  postedToastText,
  type SalesDocument,
  type SalesDocumentItem,
} from "../../lib/sales-documents";
import { mergeWarrantyTemplates, type WarrantyTemplate } from "../../lib/warranty-templates";
import { printSalesDocument } from "./SalesPrintView";

type PosLine = {
  key: string;
  stockPartId?: number | null;
  article?: string | null;
  brand?: string | null;
  name: string;
  qty: number;
  price: number;
  maxQty?: number | null;
};

type Props = {
  onClose: () => void;
  onPosted?: (docId: number) => void;
};

export function QuickReceiptPos({ onClose, onPosted }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const [lines, setLines] = useState<PosLine[]>([]);
  const [clientId, setClientId] = useState<number | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [warrantyText, setWarrantyText] = useState("");
  const [warrantyId, setWarrantyId] = useState("");
  const [missName, setMissName] = useState("");
  const [missPrice, setMissPrice] = useState("0");
  const [showMissForm, setShowMissForm] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 180);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

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

  const warrantyTemplates = useMemo(
    () => mergeWarrantyTemplates(settingsData?.settings?.warrantyTemplates),
    [settingsData?.settings?.warrantyTemplates],
  );

  const showArticles = settingsData?.settings?.receiptShowArticles !== false;

  const { data: partsData, isFetching } = useQuery({
    queryKey: ["pos-parts", debounced],
    queryFn: () => apiFetch<{ parts: Array<{ id: number; article?: string; brand?: string; name: string; qty?: number; price?: number }> }>(
      "/api/parts",
      { query: { search: debounced, article: "1" } },
    ),
    enabled: debounced.length >= 1,
  });

  const hits = (partsData?.parts || []).slice(0, 12);
  const notFound = debounced.length >= 1 && !isFetching && hits.length === 0;

  useEffect(() => {
    setActiveIdx(0);
    setShowMissForm(false);
    setMissName(debounced);
  }, [debounced, hits.length]);

  const total = lines.reduce((sum, line) => sum + lineTotal(line.qty, line.price), 0);

  const addAdHocLine = (opts: { article: string; name: string; price: number; stockPartId?: number | null }) => {
    setLines((prev) => [
      ...prev,
      {
        key: `adhoc-${Date.now()}`,
        stockPartId: opts.stockPartId ?? null,
        article: opts.article,
        brand: null,
        name: opts.name,
        qty: 1,
        price: opts.price,
        maxQty: opts.stockPartId ? null : undefined,
      },
    ]);
    setSearch("");
    setShowMissForm(false);
    searchRef.current?.focus();
  };

  const saveMissToStock = useMutation({
    mutationFn: () =>
      apiFetch<{ part: { id: number; article?: string; name: string; price?: number; qty?: number } }>(
        "/api/parts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            article: debounced,
            name: missName.trim() || debounced,
            price: parseFloat(missPrice.replace(",", ".")) || 0,
            qty: 0,
          }),
        },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["pos-parts"] });
      toast("Товар сохранён на склад — в чек без списания (остаток 0)", "success");
      // В чек без stockPartId: иначе post спишет со склада, а qty=0 → ошибка.
      addAdHocLine({
        article: res.part.article || debounced,
        name: res.part.name,
        price: Number(res.part.price) || 0,
        stockPartId: null,
      });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const addPart = (part: { id: number; article?: string; brand?: string; name: string; qty?: number; price?: number }) => {
    if ((part.qty ?? 0) <= 0) {
      toast("Нет на складе — можно добавить в чек без остатка или сохранить номенклатуру", "error");
      // still allow adding with stock id for reservation/posting rules? Keep strict for stock qty.
      // For POS: allow ad-hoc from stock card with 0 qty into line without stockPartId path via miss UI.
      return;
    }
    setLines((prev) => {
      const existing = prev.find((l) => l.stockPartId === part.id);
      if (existing) {
        const nextQty = existing.qty + 1;
        if (part.qty != null && nextQty > part.qty) {
          toast("Недостаточно на складе", "error");
          return prev;
        }
        return prev.map((l) => (l.stockPartId === part.id ? { ...l, qty: nextQty } : l));
      }
      return [
        ...prev,
        {
          key: `p-${part.id}`,
          stockPartId: part.id,
          article: part.article || null,
          brand: part.brand || null,
          name: part.name,
          qty: 1,
          price: part.price ?? 0,
          maxQty: part.qty ?? null,
        },
      ];
    });
    setSearch("");
    searchRef.current?.focus();
  };

  const postMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ doc: SalesDocument; items: SalesDocumentItem[]; manager?: { name?: string }; integrations?: unknown }>(
        "/api/sales/quick-receipt",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId,
            paymentMethod,
            warrantyText: warrantyText.trim() || undefined,
            post: true,
            items: lines.map((l) => ({
              stockPartId: l.stockPartId,
              article: l.article,
              brand: l.brand,
              name: l.name,
              qty: l.qty,
              price: l.price,
            })),
          }),
        },
      ),
    onSuccess: (data) => {
      const msg = postedToastText(data.integrations as Parameters<typeof postedToastText>[0]);
      toast(msg.text, msg.type);
      printSalesDocument({
        doc: data.doc,
        items: data.items,
        manager: data.manager,
        company: settingsData?.settings
          ? {
              companyName: settingsData.settings.companyName,
              companyInn: settingsData.settings.companyInn,
              companyAddress: settingsData.settings.companyAddress,
              companyPhone: settingsData.settings.companyPhone,
            }
          : undefined,
        printVariant: "receipt",
        showArticles,
      });
      onPosted?.(data.doc.id);
      onClose();
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const onSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(hits.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && hits[activeIdx]) {
      e.preventDefault();
      addPart(hits[activeIdx]);
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (lines.length) postMutation.mutate();
    }
  };

  const applyWarranty = (tpl: WarrantyTemplate) => {
    setWarrantyId(tpl.id);
    setWarrantyText(tpl.text);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal pos-receipt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
          <div>
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>Товарный чек</h2>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
              Поиск → Enter · Провести: Ctrl+Enter
            </p>
          </div>
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="modal__body pos-receipt-body">
          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
            Клиент
          </label>
          <ClientSearchSelect value={clientId} onChange={(id) => setClientId(id)} />

          <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", margin: "14px 0 6px" }}>
            Поиск товара
          </label>
          <input
            ref={searchRef}
            className="crm-input"
            placeholder="Артикул, название, бренд…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
          />

          {debounced.length >= 1 && (
            <div className="pos-receipt-hits">
              {isFetching && <p className="client-search__hint">Поиск…</p>}
              {notFound && (
                <SearchNotFoundCreate
                  query={debounced}
                  entityLabel="Товар"
                  documentLabel="Только в чек"
                  directoryLabel="Сохранить на склад"
                  onCreateInDocument={() =>
                    addAdHocLine({
                      article: debounced,
                      name: missName.trim() || debounced,
                      price: parseFloat(missPrice.replace(",", ".")) || 0,
                    })
                  }
                  onSaveToDirectory={() => setShowMissForm(true)}
                >
                  {showMissForm && (
                    <div className="search-miss__form">
                      <input
                        className="crm-input"
                        placeholder="Наименование *"
                        value={missName}
                        onChange={(e) => setMissName(e.target.value)}
                      />
                      <input
                        className="crm-input"
                        placeholder="Цена ₽"
                        value={missPrice}
                        onChange={(e) => setMissPrice(e.target.value)}
                      />
                      <button
                        type="button"
                        className="crm-btn crm-btn-primary"
                        disabled={saveMissToStock.isPending}
                        onClick={() => saveMissToStock.mutate()}
                      >
                        На склад и в чек
                      </button>
                    </div>
                  )}
                </SearchNotFoundCreate>
              )}
              {hits.map((part, idx) => (
                <button
                  key={part.id}
                  type="button"
                  className={`pos-receipt-hit${idx === activeIdx ? " pos-receipt-hit--on" : ""}`}
                  onClick={() => addPart(part)}
                >
                  <span className="pos-receipt-hit__main">
                    <span className="pos-receipt-hit__art">{part.article || "—"}</span>
                    <span className="pos-receipt-hit__name">
                      {part.brand ? `${part.brand} · ${part.name}` : part.name}
                    </span>
                  </span>
                  <span className="pos-receipt-hit__meta">
                    <span className={(part.qty ?? 0) <= 0 ? "is-zero" : undefined}>{part.qty ?? 0} шт</span>
                    <span>{formatMoney(part.price)}</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div className="pos-receipt-lines">
            {lines.length === 0 ? (
              <p className="pos-receipt-empty">Добавьте товары со склада — начните вводить артикул</p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    {showArticles && <th>Артикул</th>}
                    <th>Наименование</th>
                    <th>Кол-во</th>
                    <th>Цена</th>
                    <th>Сумма</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.key}>
                      {showArticles && <td style={{ fontFamily: "monospace" }}>{line.article || "—"}</td>}
                      <td>{line.brand ? `${line.brand} · ${line.name}` : line.name}</td>
                      <td>
                        <input
                          className="crm-input"
                          style={{ width: 64, height: 30, padding: "4px 8px" }}
                          type="number"
                          min={1}
                          max={line.maxQty ?? undefined}
                          value={line.qty}
                          onChange={(e) => {
                            const qty = Math.max(1, parseInt(e.target.value, 10) || 1);
                            setLines((prev) =>
                              prev.map((l) => (l.key === line.key ? { ...l, qty } : l)),
                            );
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="crm-input"
                          style={{ width: 90, height: 30, padding: "4px 8px" }}
                          type="number"
                          min={0}
                          step="0.01"
                          value={line.price}
                          onChange={(e) => {
                            const price = parseFloat(e.target.value) || 0;
                            setLines((prev) =>
                              prev.map((l) => (l.key === line.key ? { ...l, price } : l)),
                            );
                          }}
                        />
                      </td>
                      <td>{formatMoney(lineTotal(line.qty, line.price))}</td>
                      <td>
                        <button
                          type="button"
                          className="crm-btn crm-btn-ghost crm-btn-sm"
                          onClick={() => setLines((prev) => prev.filter((l) => l.key !== line.key))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div style={{ marginTop: 14 }}>
            <label style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>
              Гарантия
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {warrantyTemplates.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={`chip${warrantyId === tpl.id ? " active" : ""}`}
                  onClick={() => applyWarranty(tpl)}
                >
                  {tpl.title}
                </button>
              ))}
            </div>
            <textarea
              className="crm-input"
              rows={3}
              placeholder="Текст гарантии для печати…"
              value={warrantyText}
              onChange={(e) => {
                setWarrantyId("");
                setWarrantyText(e.target.value);
              }}
              style={{ resize: "vertical" }}
            />
          </div>
        </div>

        <div className="modal__foot pos-receipt-foot">
          <div className="pos-pay-tabs">
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
          <div className="pos-receipt-total">
            Итого <strong>{formatMoney(total)}</strong>
          </div>
          <button
            type="button"
            className="crm-btn"
            disabled={!lines.length || postMutation.isPending}
            onClick={() => postMutation.mutate()}
          >
            {postMutation.isPending ? "Проведение…" : "Провести и печать"}
          </button>
        </div>
      </div>
    </div>
  );
}
