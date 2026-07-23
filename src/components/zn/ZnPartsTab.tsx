import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { SearchNotFoundCreate } from "../SearchNotFoundCreate";
import type { PartRow } from "./zn-types";
import { money } from "./zn-types";

type StockPart = {
  id: number;
  name: string;
  article?: string | null;
  brand?: string | null;
  qty?: number | null;
  price?: number | null;
};

type SubTab = "stock" | "client" | "materials";

type Props = {
  dealId: number;
  parts: PartRow[];
  onChanged: () => void;
};

export function ZnPartsTab({ dealId, parts, onChanged }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [sub, setSub] = useState<SubTab>("stock");
  const [q, setQ] = useState("");
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [price, setPrice] = useState("0");
  const [brand, setBrand] = useState("");
  const [showDirForm, setShowDirForm] = useState(false);

  const { data: stockData, isFetching } = useQuery({
    queryKey: ["parts-search", q],
    queryFn: () =>
      apiFetch<{ parts: StockPart[] }>(
        `/api/parts?search=${encodeURIComponent(q.trim())}&limit=40`,
      ),
    enabled: sub === "stock" && q.trim().length >= 1,
  });

  const hits = stockData?.parts || [];
  const notFound = sub === "stock" && q.trim().length >= 1 && !isFetching && hits.length === 0;

  const visibleParts = useMemo(() => {
    if (sub === "client") return parts.filter((p) => p.partSource === "client");
    if (sub === "materials") return parts.filter((p) => p.partSource === "material");
    return parts.filter((p) => p.partSource !== "client" && p.partSource !== "material");
  }, [parts, sub]);

  const addLine = async (payload: Record<string, unknown>) => {
    await apiFetch(`/api/orders/${dealId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    onChanged();
  };

  const saveToStock = useMutation({
    mutationFn: async () => {
      const article = q.trim();
      const partName = name.trim() || article;
      const created = await apiFetch<{ part: StockPart }>("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article,
          name: partName,
          brand: brand.trim() || null,
          price: parseFloat(price.replace(",", ".")) || 0,
          qty: 0,
        }),
      });
      await addLine({
        name: created.part.name,
        article: created.part.article,
        brand: created.part.brand,
        qty: parseFloat(qty.replace(",", ".")) || 1,
        price: Number(created.part.price) || 0,
        partSource: "stock",
        stockPartId: created.part.id,
      });
      return created.part;
    },
    onSuccess: (part) => {
      qc.invalidateQueries({ queryKey: ["parts"] });
      toast(`На склад и в ЗН: ${part.name}`, "success");
      setQ("");
      setShowDirForm(false);
      setName("");
      setBrand("");
      setPrice("0");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const addFromStock = async (p: StockPart) => {
    try {
      await addLine({
        name: p.name,
        article: p.article,
        brand: p.brand,
        qty: 1,
        price: Number(p.price) || 0,
        partSource: "stock",
        stockPartId: p.id,
      });
      setQ("");
      toast(`Со склада: ${p.name}`, "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    }
  };

  const addManual = async (source: SubTab) => {
    const lineName = (sub === "stock" ? name || q : name).trim();
    if (!lineName) return;
    try {
      await addLine({
        name: lineName,
        article: sub === "stock" ? q.trim() || null : null,
        brand: brand.trim() || null,
        qty: parseFloat(qty.replace(",", ".")) || 1,
        price: parseFloat(price.replace(",", ".")) || 0,
        partSource: source === "stock" ? "manual" : source === "client" ? "client" : "material",
      });
      setName("");
      setQ("");
      setQty("1");
      setPrice("0");
      setBrand("");
      setShowDirForm(false);
      toast("Добавлено в ЗН", "success");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    }
  };

  const sum = visibleParts.reduce(
    (s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 1),
    0,
  );

  return (
    <div>
      <div className="zn-subtabs">
        {(
          [
            ["stock", "Товары со склада"],
            ["client", "Товары клиента"],
            ["materials", "Материалы"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`zn-subtab${sub === id ? " is-active" : ""}`}
            onClick={() => {
              setSub(id);
              setShowDirForm(false);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="zn-add-row">
        <input
          placeholder={
            sub === "stock"
              ? "Поиск: артикул, название…"
              : "Наименование…"
          }
          value={sub === "stock" ? q : name}
          onChange={(e) => {
            if (sub === "stock") {
              setQ(e.target.value);
              setName(e.target.value);
              setShowDirForm(false);
            } else setName(e.target.value);
          }}
        />
        {sub !== "stock" && (
          <>
            <input value={qty} onChange={(e) => setQty(e.target.value)} style={{ width: 72 }} placeholder="Кол-во" />
            <input value={price} onChange={(e) => setPrice(e.target.value)} style={{ width: 110 }} placeholder="Цена" />
            <button type="button" className="crm-btn crm-btn-primary" onClick={() => addManual(sub)}>
              + В документ
            </button>
          </>
        )}
      </div>

      {sub === "stock" && q.trim() && (
        <div className="zn-suggest">
          {isFetching && <div className="zn-muted" style={{ padding: 8 }}>Поиск…</div>}
          {hits.slice(0, 12).map((p) => (
            <button key={p.id} type="button" className="zn-suggest__item" onClick={() => addFromStock(p)}>
              <span>
                <strong>{p.name}</strong>
                <span className="zn-muted">
                  {" "}
                  {p.article || ""} {p.brand || ""} · ост. {p.qty ?? 0}
                </span>
              </span>
              <span>{money(p.price)}</span>
            </button>
          ))}
          {notFound && (
            <SearchNotFoundCreate
              query={q}
              entityLabel="Товар"
              documentLabel="Только в ЗН"
              directoryLabel="Сохранить на склад"
              onCreateInDocument={() => addManual("stock")}
              onSaveToDirectory={() => setShowDirForm(true)}
            >
              {showDirForm && (
                <div className="search-miss__form">
                  <input
                    className="crm-input"
                    placeholder="Наименование *"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                  <input
                    className="crm-input"
                    placeholder="Бренд"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                  />
                  <input
                    className="crm-input"
                    placeholder="Цена ₽"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                  <input
                    className="crm-input"
                    placeholder="Кол-во в ЗН"
                    value={qty}
                    onChange={(e) => setQty(e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                  <button
                    type="button"
                    className="crm-btn crm-btn-primary"
                    disabled={saveToStock.isPending}
                    onClick={() => saveToStock.mutate()}
                  >
                    {saveToStock.isPending ? "…" : "На склад и в ЗН"}
                  </button>
                </div>
              )}
            </SearchNotFoundCreate>
          )}
        </div>
      )}

      <table className="zn-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Наименование</th>
            <th>Производитель</th>
            <th>Кол-во</th>
            <th>Цена</th>
            <th>Сумма</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visibleParts.map((row, idx) => (
            <tr key={row.id}>
              <td>{idx + 1}</td>
              <td>
                <div className="zn-strong">{row.name || row.article}</div>
                {row.article && <div className="zn-muted">{row.article}</div>}
              </td>
              <td>{row.brand || "—"}</td>
              <td>{row.qty}</td>
              <td>{money(row.price)}</td>
              <td className="zn-sum">{money((Number(row.price) || 0) * (Number(row.qty) || 1))}</td>
              <td>
                <button
                  type="button"
                  className="crm-btn crm-btn-ghost"
                  onClick={async () => {
                    await apiFetchVoid(`/api/orders/items/${row.id}`, { method: "DELETE" });
                    onChanged();
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {visibleParts.length === 0 && (
            <tr>
              <td colSpan={7} className="zn-muted">
                Пусто — найдите на складе или создайте позицию
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="zn-footer-sum">
        Итого: <strong>{money(sum)}</strong>
      </div>
    </div>
  );
}
