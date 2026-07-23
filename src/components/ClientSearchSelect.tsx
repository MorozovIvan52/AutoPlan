import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/fetch-api";
import { useToast } from "../lib/toast";
import { SearchNotFoundCreate } from "./SearchNotFoundCreate";

type ClientRow = { id: number; name: string; phone?: string | null };

function parseQuickClient(input: string): { name: string; phone: string } {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 10) {
    const normalized = digits.length === 11 && digits.startsWith("8") ? `7${digits.slice(1)}` : digits;
    const full = normalized.length === 10 ? `7${normalized}` : normalized;
    return { name: trimmed, phone: `+${full}` };
  }
  return { name: trimmed, phone: "" };
}

function phoneDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 11 && (digits.startsWith("7") || digits.startsWith("8"))) return digits.slice(1);
  if (digits.length === 10) return digits;
  if (digits.length > 10) return digits.slice(-10);
  return digits;
}

type Props = {
  value: number | null;
  onChange: (clientId: number | null, client?: ClientRow | null) => void;
  placeholder?: string;
  allowClear?: boolean;
  allowCreate?: boolean;
};

export function ClientSearchSelect({
  value,
  onChange,
  placeholder = "Поиск клиента: имя или телефон…",
  allowClear = true,
  allowCreate = true,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 250);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching } = useQuery({
    queryKey: ["client-search", debounced],
    queryFn: () => {
      const digits = phoneDigits(debounced);
      return apiFetch<{ clients: ClientRow[] }>("/api/clients", {
        query: { search: debounced, ...(digits.length >= 4 ? { phoneDigits: digits } : {}) },
      });
    },
    enabled: open && debounced.length >= 1,
  });

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; phone?: string }) =>
      apiFetch<{ client: ClientRow }>("/api/clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, source: "manual" }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client-search"] });
      if (res.client) pickClient(res.client);
      toast("Клиент создан", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  useEffect(() => {
    if (!value) {
      setLabel("");
      return;
    }
    if (label) return;
    apiFetch<{ client: ClientRow }>(`/api/clients/${value}`)
      .then((res) => setLabel(res.client.phone ? `${res.client.name} · ${res.client.phone}` : res.client.name))
      .catch(() => setLabel(`#${value}`));
  }, [value, label]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const clients = (data?.clients || []).slice(0, 20);
  const trimmed = query.trim();
  const ready = trimmed === debounced;

  const pickClient = (client: ClientRow) => {
    onChange(client.id, client);
    setLabel(client.phone ? `${client.name} · ${client.phone}` : client.name);
    setQuery("");
    setOpen(false);
  };

  const clear = () => {
    onChange(null, null);
    setLabel("");
    setQuery("");
  };

  const createClient = () => {
    if (!trimmed) return;
    const { name, phone } = parseQuickClient(trimmed);
    if (name) createMutation.mutate({ name, phone: phone || undefined });
  };

  return (
    <div className="client-search" ref={rootRef}>
      {value && label && !open ? (
        <div className="client-search__picked">
          <span>{label}</span>
          {allowClear && (
            <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={clear}>
              ✕
            </button>
          )}
          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setOpen(true)}>
            Изменить
          </button>
        </div>
      ) : (
        <>
          <input
            className="crm-input"
            placeholder={placeholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            autoComplete="off"
          />
          {open && (
            <div className="client-search__list">
              {isFetching && <p className="client-search__hint">Поиск…</p>}
              {!isFetching && !trimmed && clients.length === 0 && (
                <p className="client-search__hint">Введите имя или телефон</p>
              )}
              {clients.map((client) => (
                <button
                  key={client.id}
                  type="button"
                  className={`client-search__item${value === client.id ? " active" : ""}`}
                  onClick={() => pickClient(client)}
                >
                  <strong>{client.name}</strong>
                  {client.phone && <span>{client.phone}</span>}
                </button>
              ))}
              {allowCreate && trimmed && ready && !isFetching && clients.length === 0 && (
                <SearchNotFoundCreate
                  query={trimmed}
                  entityLabel="Клиент"
                  directoryLabel={
                    createMutation.isPending ? "Создаём…" : "Сохранить в справочник"
                  }
                  hint="Клиент сохраняется в базе навсегда и будет доступен во всех документах."
                  onSaveToDirectory={createClient}
                />
              )}
              {allowCreate && trimmed && ready && !isFetching && clients.length > 0 && (
                <button
                  type="button"
                  className="client-search__create"
                  disabled={createMutation.isPending}
                  onClick={createClient}
                >
                  {createMutation.isPending ? "Создаём клиента…" : `+ Создать ещё «${trimmed}»`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
