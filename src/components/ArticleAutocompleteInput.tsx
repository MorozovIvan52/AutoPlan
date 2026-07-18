import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../lib/fetch-api";
import { formatMoney } from "../lib/sales-documents";

type PartRow = {
  id: number;
  article?: string | null;
  brand?: string | null;
  name: string;
  qty?: number | null;
  price?: number | null;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSelect?: (part: PartRow) => void;
  onBlur?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  minChars?: number;
};

export function ArticleAutocompleteInput({
  value,
  onChange,
  onSelect,
  onBlur,
  placeholder = "Артикул",
  disabled = false,
  className = "crm-input",
  style,
  minChars = 1,
}: Props) {
  const [local, setLocal] = useState(value);
  const [debounced, setDebounced] = useState(value);
  const [open, setOpen] = useState(false);
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
    queryFn: () => apiFetch<{ parts: PartRow[] }>("/api/parts", { query: { search: debounced, article: "1" } }),
    enabled: open && debounced.length >= minChars,
  });

  const parts = (data?.parts || []).slice(0, 12);
  const showList = open && debounced.length >= minChars && !disabled;
  const synced = debounced === local.trim();

  const pick = (part: PartRow) => {
    const article = part.article || "";
    setLocal(article);
    onChange(article);
    onSelect?.(part);
    setOpen(false);
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
        }}
        onBlur={() => onBlur?.(local.trim())}
        onKeyDown={(e) => {
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {showList && (
        <div className="article-ac__list">
          {isFetching && <p className="article-ac__hint">Поиск…</p>}
          {!isFetching && synced && parts.length === 0 && (
            <p className="article-ac__hint">На складе нет артикулов с «{debounced}»</p>
          )}
          {parts.map((part) => (
            <button
              key={part.id}
              type="button"
              className="article-ac__item"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(part)}
            >
              <span className="article-ac__art">{part.article || "—"}</span>
              <span className="article-ac__name">{part.brand ? `${part.brand} · ${part.name}` : part.name}</span>
              <span className="article-ac__meta">
                {part.qty ?? 0} шт · {formatMoney(part.price)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
