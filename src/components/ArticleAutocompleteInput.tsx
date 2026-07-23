import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/fetch-api";
import { formatMoney } from "../lib/sales-documents";
import { useToast } from "../lib/toast";
import { SearchNotFoundCreate } from "./SearchNotFoundCreate";

export type PartRow = {
  id: number;
  article?: string | null;
  brand?: string | null;
  name: string;
  qty?: number | null;
  price?: number | null;
};

export type AdHocPart = {
  article: string;
  name: string;
  brand?: string;
  price: number;
  stockPartId?: number | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (part: PartRow) => void;
  /** Добавить в документ без склада */
  onCreateInDocument?: (item: AdHocPart) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  minChars?: number;
  allowCreate?: boolean;
};

export function ArticleAutocompleteInput({
  value,
  onChange,
  onSelect,
  onCreateInDocument,
  onBlur,
  placeholder = "Артикул / название",
  disabled = false,
  className = "crm-input",
  style,
  minChars = 1,
  allowCreate = true,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [local, setLocal] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
  const [showDirForm, setShowDirForm] = useState(false);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("0");
  const [brand, setBrand] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setLocal(value), [value]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(local.trim()), 180);
    return () => clearTimeout(t);
  }, [local]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const { data, isFetching } = useQuery({
    queryKey: ["parts-article-ac", debounced],
    queryFn: () =>
      apiFetch<{ parts: PartRow[] }>("/api/parts", {
        query: { search: debounced, article: "1" },
      }),
    enabled: open && debounced.length >= minChars,
  });

  const savePart = useMutation({
    mutationFn: () =>
      apiFetch<{ part: PartRow }>("/api/parts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          article: debounced,
          name: name.trim() || debounced,
          brand: brand.trim() || null,
          price: parseFloat(price.replace(",", ".")) || 0,
          qty: 0,
        }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["parts-article-ac"] });
      qc.invalidateQueries({ queryKey: ["parts"] });
      toast("Товар сохранён на склад", "success");
      if (res.part) {
        onSelect?.(res.part);
        setLocal(res.part.article || debounced);
        onChange(res.part.article || debounced);
      }
      setShowDirForm(false);
      setOpen(false);
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const parts = (data?.parts || []).slice(0, 12);
  const showList = open && debounced.length >= minChars && !disabled;
  const synced = debounced === local.trim();
  const notFound = !isFetching && synced && parts.length === 0;

  const pick = (part: PartRow) => {
    const article = part.article || "";
    setLocal(article);
    onChange(article);
    onSelect?.(part);
    setOpen(false);
    setShowDirForm(false);
  };

  const addDocOnly = () => {
    onCreateInDocument?.({
      article: debounced,
      name: name.trim() || debounced,
      brand: brand.trim() || undefined,
      price: parseFloat(price.replace(",", ".")) || 0,
      stockPartId: null,
    });
    setOpen(false);
    setShowDirForm(false);
  };

  return (
    <div className="article-ac" ref={rootRef} style={style}>
      <input
        className={className}
        placeholder={placeholder}
        value={local}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setLocal(e.target.value);
          onChange(e.target.value);
          setOpen(true);
          setShowDirForm(false);
          setName(e.target.value.trim());
        }}
        onBlur={() => onBlur?.(local.trim())}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {showList && (
        <div className="article-ac__list">
          {isFetching && <p className="article-ac__hint">Поиск…</p>}
          {parts.map((part) => (
            <button
              key={part.id}
              type="button"
              className="article-ac__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(part)}
            >
              <span className="article-ac__art">{part.article || "—"}</span>
              <span className="article-ac__name">
                {part.brand ? `${part.brand} · ${part.name}` : part.name}
              </span>
              <span className="article-ac__meta">
                {part.qty ?? 0} шт · {formatMoney(part.price)}
              </span>
            </button>
          ))}
          {allowCreate && notFound && (
            <SearchNotFoundCreate
              query={debounced}
              entityLabel="Товар"
              documentLabel="Только в документ"
              directoryLabel="Сохранить на склад"
              onCreateInDocument={onCreateInDocument ? addDocOnly : undefined}
              onSaveToDirectory={() => {
                setShowDirForm(true);
                if (!name) setName(debounced);
              }}
            >
              {showDirForm && (
                <div className="search-miss__form" onMouseDown={(e) => e.preventDefault()}>
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
                    inputMode="decimal"
                  />
                  <div className="search-miss__actions">
                    {onCreateInDocument && (
                      <button type="button" className="crm-btn" onClick={addDocOnly}>
                        В документ
                      </button>
                    )}
                    <button
                      type="button"
                      className="crm-btn crm-btn-primary"
                      disabled={savePart.isPending || !name.trim()}
                      onClick={() => savePart.mutate()}
                    >
                      {savePart.isPending ? "Сохраняем…" : "На склад и в документ"}
                    </button>
                  </div>
                </div>
              )}
            </SearchNotFoundCreate>
          )}
        </div>
      )}
    </div>
  );
}
