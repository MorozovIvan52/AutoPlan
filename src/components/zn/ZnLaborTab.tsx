import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { SearchNotFoundCreate } from "../SearchNotFoundCreate";
import type { LaborRow } from "./zn-types";
import { money } from "./zn-types";
import { ZnLaborCatalogModal } from "./ZnLaborCatalogModal";

type CatalogItem = {
  id?: number;
  code: string;
  name: string;
  norm_hours?: number;
  normHours?: number;
  hourly_rate?: number | null;
  category?: string | null;
};

type Props = {
  dealId: number;
  labor: LaborRow[];
  onChanged: () => void;
};

export function ZnLaborTab({ dealId, labor, onChanged }: Props) {
  const { toast } = useToast();
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [quick, setQuick] = useState("");
  const [debounced, setDebounced] = useState("");
  const [hours, setHours] = useState("1");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [createPanel, setCreatePanel] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(quick.trim()), 200);
    return () => clearTimeout(t);
  }, [quick]);

  const { data: catalogData, isFetching } = useQuery({
    queryKey: ["sto-labor-catalog-all"],
    queryFn: () => apiFetch<{ items: CatalogItem[] }>("/api/sto/labor-catalog/all"),
  });

  const hits = useMemo(() => {
    const qq = debounced.toLowerCase();
    if (!qq) return [];
    return (catalogData?.items || [])
      .filter(
        (i) =>
          i.name.toLowerCase().includes(qq) ||
          (i.code || "").toLowerCase().includes(qq),
      )
      .slice(0, 10);
  }, [catalogData?.items, debounced]);

  const notFound = debounced.length >= 1 && !isFetching && hits.length === 0;

  const addManual = async (opts?: {
    name?: string;
    normHours?: number;
    price?: number;
    saveToCatalog?: boolean;
    catalogCode?: string;
  }) => {
    const name = (opts?.name || quick).trim();
    if (!name) return;
    const normHours = opts?.normHours ?? (parseFloat(hours.replace(",", ".")) || 1);
    const linePrice =
      opts?.price ?? (price.trim() ? parseFloat(price.replace(",", ".")) : undefined);
    setBusy(true);
    try {
      let catalogCode = opts?.catalogCode;
      if (opts?.saveToCatalog && !catalogCode) {
        catalogCode = `ZN-${name
          .toUpperCase()
          .replace(/[^A-ZА-Я0-9]+/gi, "-")
          .slice(0, 20)}-${Date.now().toString(36).slice(-4)}`;
        await apiFetch("/api/sto/labor-catalog", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: catalogCode,
            name,
            normHours,
            category: "ПРОЧЕЕ",
            hourlyRate: linePrice != null && normHours > 0 ? linePrice / normHours : null,
          }),
        });
      }
      await apiFetch(`/api/orders/${dealId}/labor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(catalogCode ? { catalogCode } : {}),
          name,
          normHours,
          price: linePrice,
        }),
      });
      toast(opts?.saveToCatalog ? "Работа в справочнике и в ЗН" : "Работа добавлена в ЗН", "success");
      setQuick("");
      setHours("1");
      setPrice("");
      setCreatePanel(false);
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    } finally {
      setBusy(false);
    }
  };

  const addFromCatalog = async (item: {
    catalogCode: string;
    name: string;
    normHours: number;
    price?: number;
  }) => {
    try {
      await apiFetch(`/api/orders/${dealId}/labor`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogCode: item.catalogCode,
          name: item.name,
          normHours: item.normHours,
          price: item.price,
        }),
      });
      onChanged();
      toast(`Добавлено: ${item.name}`, "success");
      setQuick("");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка", "error");
    }
  };

  const applyComplex = async (complexId: number) => {
    try {
      await apiFetch(`/api/sto/deals/${dealId}/apply-complex/${complexId}`, { method: "POST" });
      onChanged();
      toast("Комплекс добавлен в ЗН", "success");
      setCatalogOpen(false);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Ошибка комплекса", "error");
    }
  };

  const sum = labor.reduce((s, x) => s + (Number(x.price) || 0), 0);

  return (
    <div>
      <div className="zn-labor-toolbar">
        <button type="button" className="crm-btn crm-btn-primary" onClick={() => setCatalogOpen(true)}>
          Каталог работ
        </button>
        <button
          type="button"
          className="crm-btn"
          onClick={() => {
            setCreatePanel(true);
            setQuick((q) => q || "");
          }}
        >
          + Создать работу
        </button>
      </div>

      <div className="zn-add-row zn-add-row--labor">
        <div className="zn-labor-search">
          <input
            placeholder="Поиск наименования работы…"
            value={quick}
            onChange={(e) => {
              setQuick(e.target.value);
              setCreatePanel(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                e.preventDefault();
                const h = hits[0];
                const nh = Number(h.norm_hours ?? h.normHours) || 1;
                const rate = Number(h.hourly_rate) || 0;
                void addFromCatalog({
                  catalogCode: h.code,
                  name: h.name,
                  normHours: nh,
                  price: rate ? rate * nh : undefined,
                });
              }
            }}
          />
          {debounced.length >= 1 && (
            <div className="zn-labor-suggest">
              {isFetching && <div className="zn-muted" style={{ padding: 8 }}>Поиск…</div>}
              {hits.map((h) => {
                const nh = Number(h.norm_hours ?? h.normHours) || 1;
                const rate = Number(h.hourly_rate) || 0;
                return (
                  <button
                    key={`${h.code}-${h.id || 0}`}
                    type="button"
                    className="zn-suggest__item"
                    onClick={() =>
                      addFromCatalog({
                        catalogCode: h.code,
                        name: h.name,
                        normHours: nh,
                        price: rate ? rate * nh : undefined,
                      })
                    }
                  >
                    <span>
                      <strong>{h.name}</strong>
                      <span className="zn-muted"> {h.code}</span>
                    </span>
                    <span>
                      {nh} н/ч
                      {rate ? ` · ${money(rate * nh)}` : ""}
                    </span>
                  </button>
                );
              })}
              {notFound && (
                <SearchNotFoundCreate
                  query={debounced}
                  entityLabel="Работа"
                  documentLabel="Только в ЗН"
                  directoryLabel="В справочник и в ЗН"
                  onCreateInDocument={() => addManual({ name: debounced })}
                  onSaveToDirectory={() => addManual({ name: debounced, saveToCatalog: true })}
                />
              )}
            </div>
          )}
        </div>
        <input
          placeholder="Н/ч"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          style={{ width: 72 }}
        />
        <input
          placeholder="Цена ₽"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          style={{ width: 110 }}
        />
        <button
          type="button"
          className="crm-btn crm-btn-primary"
          disabled={!quick.trim() || busy}
          onClick={() => addManual()}
        >
          + В ЗН
        </button>
        <button
          type="button"
          className="crm-btn"
          disabled={!quick.trim() || busy}
          onClick={() => addManual({ saveToCatalog: true })}
        >
          В справочник
        </button>
      </div>

      {createPanel && (
        <div className="zn-create-work" style={{ marginBottom: 12 }}>
          <div className="zn-create-work__title">Создать работу</div>
          <p className="zn-muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
            Укажите наименование выше, н/ч и цену — затем сохраните в ЗН или в справочник навсегда.
          </p>
          <div className="search-miss__actions">
            <button
              type="button"
              className="crm-btn crm-btn-primary"
              disabled={!quick.trim() || busy}
              onClick={() => addManual()}
            >
              Только в ЗН
            </button>
            <button
              type="button"
              className="crm-btn"
              disabled={!quick.trim() || busy}
              onClick={() => addManual({ saveToCatalog: true })}
            >
              В справочник и в ЗН
            </button>
            <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setCreatePanel(false)}>
              Скрыть
            </button>
          </div>
        </div>
      )}

      <table className="zn-table">
        <thead>
          <tr>
            <th>№</th>
            <th>Наименование</th>
            <th>Исполнитель</th>
            <th>Н/ч</th>
            <th>Сумма</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {labor.map((row, idx) => (
            <tr key={row.id}>
              <td>{idx + 1}</td>
              <td>
                <div className="zn-strong">{row.name}</div>
                {row.code && <div className="zn-muted">{row.code}</div>}
              </td>
              <td>{row.executorName || "—"}</td>
              <td>{row.normHours ?? row.hours ?? "—"}</td>
              <td className="zn-sum">{money(row.price)}</td>
              <td>
                <button
                  type="button"
                  className="crm-btn crm-btn-ghost"
                  onClick={async () => {
                    await apiFetchVoid(`/api/orders/labor/${row.id}`, { method: "DELETE" });
                    onChanged();
                  }}
                >
                  ✕
                </button>
              </td>
            </tr>
          ))}
          {labor.length === 0 && (
            <tr>
              <td colSpan={6} className="zn-muted">
                Работ пока нет — найдите в каталоге или создайте новую
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="zn-footer-sum">
        Итого работы: <strong>{money(sum)}</strong>
      </div>

      <ZnLaborCatalogModal
        open={catalogOpen}
        onClose={() => setCatalogOpen(false)}
        onAddCatalog={addFromCatalog}
        onApplyComplex={applyComplex}
        onAddManual={(item) => {
          void addManual({
            name: item.name,
            normHours: item.normHours,
            price: item.price,
          });
          setCatalogOpen(false);
        }}
      />
    </div>
  );
}
