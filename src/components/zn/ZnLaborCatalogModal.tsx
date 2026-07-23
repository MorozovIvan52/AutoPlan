import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { SearchNotFoundCreate } from "../SearchNotFoundCreate";
import { money } from "./zn-types";
import { STO_LABOR_GROUPS, mapLaborCategoryToGroup } from "./zn-labor-groups";

type CatalogItem = {
  id?: number;
  code: string;
  name: string;
  norm_hours?: number;
  normHours?: number;
  category?: string | null;
  hourly_rate?: number | null;
};

type Complex = {
  id: number;
  name: string;
  code?: string;
  category?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onAddCatalog: (item: { catalogCode: string; name: string; normHours: number; price?: number }) => void;
  onApplyComplex: (complexId: number) => void;
  onAddManual?: (item: { name: string; normHours: number; price?: number }) => void;
};

function slugCode(name: string, group: string) {
  const base = name
    .trim()
    .toUpperCase()
    .replace(/[^A-ZА-Я0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24);
  const g = group.slice(0, 3).toUpperCase();
  return `${g}-${base || "WORK"}-${Date.now().toString(36).slice(-4)}`;
}

export function ZnLaborCatalogModal({
  open,
  onClose,
  onAddCatalog,
  onApplyComplex,
  onAddManual,
}: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const [group, setGroup] = useState<string>("ДВИГАТЕЛЬ");
  const [q, setQ] = useState("");
  const [scopeAll, setScopeAll] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [formName, setFormName] = useState("");
  const [formHours, setFormHours] = useState("1");
  const [formPrice, setFormPrice] = useState("");
  const [formGroup, setFormGroup] = useState<string>("ПРОЧЕЕ");
  const complexesMode = group === "__complexes__";

  useEffect(() => {
    if (!open) return;
    setTimeout(() => searchRef.current?.focus(), 50);
  }, [open]);

  const { data: catalogData, isFetching } = useQuery({
    queryKey: ["sto-labor-catalog-all"],
    queryFn: () => apiFetch<{ items: CatalogItem[] }>("/api/sto/labor-catalog/all"),
    enabled: open,
  });

  const { data: complexesData } = useQuery({
    queryKey: ["sto-labor-complexes"],
    queryFn: () =>
      apiFetch<{ complexes: Complex[]; items?: unknown[] }>("/api/sto/labor-complexes"),
    enabled: open,
  });

  const byGroup = useMemo(() => {
    const map = new Map<string, CatalogItem[]>();
    for (const g of STO_LABOR_GROUPS) map.set(g, []);
    for (const item of catalogData?.items || []) {
      const g = mapLaborCategoryToGroup(item.category);
      const list = map.get(g) || [];
      list.push(item);
      map.set(g, list);
    }
    return map;
  }, [catalogData?.items]);

  const allItems = catalogData?.items || [];

  const filtered = useMemo(() => {
    if (complexesMode) return [];
    const qq = q.trim().toLowerCase();
    // Без поиска — текущая группа; с поиском — по всему каталогу (как в АвтоДилере)
    if (!qq) return byGroup.get(group) || [];
    const base = scopeAll ? allItems : byGroup.get(group) || [];
    return base.filter(
      (i) =>
        i.name.toLowerCase().includes(qq) ||
        (i.code || "").toLowerCase().includes(qq) ||
        (i.category || "").toLowerCase().includes(qq),
    );
  }, [allItems, byGroup, group, q, scopeAll, complexesMode]);

  const complexes = complexesData?.complexes || [];
  const searchMiss = !complexesMode && q.trim().length >= 1 && filtered.length === 0 && !isFetching;

  const openCreate = (prefill = "") => {
    setFormName(prefill || q.trim());
    setFormGroup(complexesMode || !group || group === "__complexes__" ? "ПРОЧЕЕ" : group);
    setFormHours("1");
    setFormPrice("");
    setCreateOpen(true);
  };

  const saveToCatalog = useMutation({
    mutationFn: async () => {
      const name = formName.trim();
      if (!name) throw new Error("Укажите наименование");
      const code = slugCode(name, formGroup);
      const normHours = parseFloat(formHours.replace(",", ".")) || 1;
      const price = formPrice.trim() ? parseFloat(formPrice.replace(",", ".")) : undefined;
      const hourlyRate = price != null && normHours > 0 ? Math.round((price / normHours) * 100) / 100 : null;
      await apiFetch("/api/sto/labor-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          normHours,
          category: formGroup,
          hourlyRate,
        }),
      });
      return { code, name, normHours, price };
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ["sto-labor-catalog-all"] });
      toast("Работа сохранена в справочник", "success");
      onAddCatalog({
        catalogCode: item.code,
        name: item.name,
        normHours: item.normHours,
        price: item.price,
      });
      setCreateOpen(false);
      setQ("");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (!open) return null;

  return (
    <div className="zn-modal-backdrop" role="dialog" aria-modal="true">
      <div className="zn-modal zn-modal--wide zn-catalog-modal">
        <div className="zn-modal__head">
          <div>
            <h2>Каталог работ</h2>
            <p className="zn-muted" style={{ margin: "4px 0 0", fontSize: 12 }}>
              Как в АвтоДилере: поиск по наименованию → добавить в ЗН или создать в справочнике
            </p>
          </div>
          <div className="zn-catalog-modal__head-actions">
            <button type="button" className="crm-btn crm-btn-primary" onClick={() => openCreate()}>
              + Создать работу
            </button>
            <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose}>
              ✕
            </button>
          </div>
        </div>

        <div className="zn-catalog-searchbar">
          <input
            ref={searchRef}
            className="zn-catalog-searchbar__input"
            placeholder="Поиск наименования работы, кода…"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              if (e.target.value.trim()) setScopeAll(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchMiss) openCreate(q);
            }}
          />
          <label className="zn-catalog-searchbar__scope">
            <input
              type="checkbox"
              checked={scopeAll}
              onChange={(e) => setScopeAll(e.target.checked)}
            />
            Искать везде
          </label>
        </div>

        {createOpen && (
          <div className="zn-create-work">
            <div className="zn-create-work__title">Новая работа в справочнике</div>
            <div className="zn-create-work__grid">
              <input
                className="crm-input"
                placeholder="Наименование *"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                autoFocus
              />
              <select
                className="crm-input"
                value={formGroup}
                onChange={(e) => setFormGroup(e.target.value)}
              >
                {STO_LABOR_GROUPS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <input
                className="crm-input"
                placeholder="Н/ч"
                value={formHours}
                onChange={(e) => setFormHours(e.target.value)}
              />
              <input
                className="crm-input"
                placeholder="Цена ₽"
                value={formPrice}
                onChange={(e) => setFormPrice(e.target.value)}
              />
            </div>
            <div className="search-miss__actions">
              {onAddManual && (
                <button
                  type="button"
                  className="crm-btn"
                  onClick={() => {
                    onAddManual({
                      name: formName.trim() || q.trim(),
                      normHours: parseFloat(formHours.replace(",", ".")) || 1,
                      price: formPrice.trim()
                        ? parseFloat(formPrice.replace(",", "."))
                        : undefined,
                    });
                    setCreateOpen(false);
                  }}
                >
                  Только в этот ЗН
                </button>
              )}
              <button
                type="button"
                className="crm-btn crm-btn-primary"
                disabled={saveToCatalog.isPending || !formName.trim()}
                onClick={() => saveToCatalog.mutate()}
              >
                {saveToCatalog.isPending ? "Сохраняем…" : "В справочник и в ЗН"}
              </button>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => setCreateOpen(false)}>
                Отмена
              </button>
            </div>
          </div>
        )}

        <div className="zn-catalog">
          <aside className="zn-catalog__side">
            <button
              type="button"
              className={`zn-catalog__group${complexesMode ? " is-active" : ""}`}
              onClick={() => {
                setGroup("__complexes__");
                setQ("");
              }}
            >
              Комплексы (ваши)
            </button>
            {STO_LABOR_GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                className={`zn-catalog__group${group === g && !complexesMode ? " is-active" : ""}`}
                onClick={() => {
                  setGroup(g);
                  setScopeAll(false);
                }}
              >
                {g}
                <span className="zn-muted">{byGroup.get(g)?.length || 0}</span>
              </button>
            ))}
          </aside>

          <div className="zn-catalog__main">
            {complexesMode ? (
              <table className="zn-table">
                <thead>
                  <tr>
                    <th>Комплекс</th>
                    <th>Код</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {complexes.map((c) => (
                    <tr key={c.id}>
                      <td>{c.name}</td>
                      <td className="zn-muted">{c.code || "—"}</td>
                      <td>
                        <button
                          type="button"
                          className="crm-btn crm-btn-primary"
                          onClick={() => onApplyComplex(c.id)}
                        >
                          Добавить
                        </button>
                      </td>
                    </tr>
                  ))}
                  {complexes.length === 0 && (
                    <tr>
                      <td colSpan={3} className="zn-muted">
                        Комплексы создаёт ваша компания в справочнике — готовых пресетов нет.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            ) : (
              <>
                {searchMiss && (
                  <div style={{ padding: 12 }}>
                    <SearchNotFoundCreate
                      query={q}
                      entityLabel="Работа"
                      documentLabel="Только в ЗН"
                      directoryLabel="+ Создать работу"
                      hint="Работы нет в справочнике. Добавьте в этот ЗН или сохраните навсегда."
                      onCreateInDocument={
                        onAddManual
                          ? () =>
                              onAddManual({
                                name: q.trim(),
                                normHours: 1,
                              })
                          : undefined
                      }
                      onSaveToDirectory={() => openCreate(q)}
                    />
                  </div>
                )}
                <table className="zn-table">
                  <thead>
                    <tr>
                      <th>Наименование</th>
                      {(scopeAll || q.trim()) && <th>Группа</th>}
                      <th>Н/ч</th>
                      <th>Ориентир</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {isFetching && filtered.length === 0 && (
                      <tr>
                        <td colSpan={5} className="zn-muted">
                          Поиск…
                        </td>
                      </tr>
                    )}
                    {filtered.map((item) => {
                      const hours = Number(item.norm_hours ?? item.normHours) || 1;
                      const rate = Number(item.hourly_rate) || 0;
                      return (
                        <tr key={`${item.code}-${item.id || 0}`}>
                          <td>
                            <div className="zn-strong">{item.name}</div>
                            <div className="zn-muted">{item.code}</div>
                          </td>
                          {(scopeAll || q.trim()) && (
                            <td className="zn-muted">{mapLaborCategoryToGroup(item.category)}</td>
                          )}
                          <td>{hours}</td>
                          <td>{rate ? money(rate * hours) : "—"}</td>
                          <td>
                            <button
                              type="button"
                              className="crm-btn crm-btn-primary"
                              onClick={() =>
                                onAddCatalog({
                                  catalogCode: item.code,
                                  name: item.name,
                                  normHours: hours,
                                  price: rate ? rate * hours : undefined,
                                })
                              }
                            >
                              +
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {!searchMiss && !isFetching && filtered.length === 0 && (
                      <tr>
                        <td colSpan={5}>
                          <div className="zn-catalog-empty">
                            <p>В этой группе пока нет работ</p>
                            <button
                              type="button"
                              className="crm-btn crm-btn-primary"
                              onClick={() => openCreate()}
                            >
                              + Создать работу
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
