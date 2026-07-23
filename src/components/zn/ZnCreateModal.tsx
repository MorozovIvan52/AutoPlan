import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../../lib/fetch-api";
import { useToast } from "../../lib/toast";
import { SearchNotFoundCreate } from "../SearchNotFoundCreate";

type Client = { id: number; name: string | null; phone: string | null };

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (dealId: number) => void;
};

function fullName(last: string, first: string, middle: string) {
  return [last.trim(), first.trim(), middle.trim()].filter(Boolean).join(" ");
}

export function ZnCreateModal({ open, onClose, onCreated }: Props) {
  const { toast } = useToast();
  const [clientQ, setClientQ] = useState("");
  const [clientId, setClientId] = useState<number | null>(null);
  const [clientLabel, setClientLabel] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [phone, setPhone] = useState("");
  const [title, setTitle] = useState("Заказ-наряд");
  const [busy, setBusy] = useState(false);

  const { data, isFetching } = useQuery({
    queryKey: ["clients-for-zn", clientQ],
    queryFn: () =>
      apiFetch<{ clients: Client[] }>("/api/clients", {
        query: { search: clientQ.trim(), limit: "30" },
      }),
    enabled: open && !createNew && clientQ.trim().length >= 1,
  });

  const suggestions = useMemo(() => data?.clients || [], [data?.clients]);
  const showNotFound =
    !createNew &&
    !clientId &&
    clientQ.trim().length >= 1 &&
    !isFetching &&
    suggestions.length === 0;

  useEffect(() => {
    if (!open) return;
    // reset soft state when reopening
  }, [open]);

  if (!open) return null;

  const reset = () => {
    setClientId(null);
    setClientLabel("");
    setClientQ("");
    setCreateNew(false);
    setLastName("");
    setFirstName("");
    setMiddleName("");
    setPhone("");
    setTitle("Заказ-наряд");
  };

  const startCreateNew = () => {
    setCreateNew(true);
    setClientId(null);
    setClientLabel("");
    // Prefill from search if it looks like a name (not phone-only)
    const q = clientQ.trim();
    if (q && !/^\+?\d[\d\s()-]{5,}$/.test(q)) {
      const parts = q.split(/\s+/).filter(Boolean);
      if (parts[0]) setLastName(parts[0]!);
      if (parts[1]) setFirstName(parts[1]!);
      if (parts[2]) setMiddleName(parts.slice(2).join(" "));
    } else if (q && /^\+?\d/.test(q)) {
      setPhone(q);
    }
  };

  const submit = async () => {
    if (!title.trim()) {
      toast("Укажите причину обращения", "error");
      return;
    }

    setBusy(true);
    try {
      let cid = clientId;
      if (!cid) {
        if (!createNew) {
          toast("Выберите клиента или создайте нового", "error");
          setBusy(false);
          return;
        }
        if (!lastName.trim() || !firstName.trim()) {
          toast("Укажите фамилию и имя", "error");
          setBusy(false);
          return;
        }
        if (!phone.trim()) {
          toast("Укажите номер телефона", "error");
          setBusy(false);
          return;
        }
        const name = fullName(lastName, firstName, middleName);
        const created = await apiFetch<{ client: { id: number; name: string | null } }>(
          "/api/clients",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              phone: phone.trim(),
              source: "zn",
            }),
          },
        );
        cid = created.client.id;
      }

      const res = await apiFetch<{ deal: { id: number } }>("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: cid,
          title: title.trim(),
          orderType: "service",
          status: "new",
        }),
      });
      toast(createNew ? "Клиент и ЗН созданы" : "ЗН создан", "success");
      onCreated(res.deal.id);
      onClose();
      reset();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Не удалось создать ЗН", "error");
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = Boolean(title.trim()) && (Boolean(clientId) || createNew);

  return (
    <div className="zn-modal-backdrop" role="dialog" aria-modal="true">
      <div className="zn-modal">
        <div className="zn-modal__head">
          <h2>Новый заказ-наряд</h2>
          <button type="button" className="crm-btn crm-btn-ghost" onClick={onClose} disabled={busy}>
            ✕
          </button>
        </div>

        {!createNew && (
          <>
            <label className="zn-field zn-field--wide">
              <span>Клиент *</span>
              <input
                placeholder="Поиск: фамилия, имя или телефон…"
                value={clientId ? clientLabel : clientQ}
                onChange={(e) => {
                  setClientId(null);
                  setClientLabel("");
                  setClientQ(e.target.value);
                }}
              />
            </label>

            {!clientId && clientQ.trim().length >= 1 && (
              <div className="zn-suggest">
                {suggestions.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className="zn-suggest__item"
                    onClick={() => {
                      setClientId(c.id);
                      setClientLabel(`${c.name || "Клиент"}${c.phone ? ` · ${c.phone}` : ""}`);
                      setClientQ("");
                    }}
                  >
                    <span>
                      <strong>{c.name || "Без имени"}</strong>
                      <span className="zn-muted"> {c.phone || ""}</span>
                    </span>
                  </button>
                ))}
                {showNotFound && (
                  <div className="zn-suggest-empty">
                    <SearchNotFoundCreate
                      query={clientQ}
                      entityLabel="Клиент"
                      directoryLabel="Создать в справочнике"
                      hint="Клиент сохранится в базе и будет доступен во всех ЗН и документах."
                      onSaveToDirectory={startCreateNew}
                    />
                  </div>
                )}
              </div>
            )}

            {!clientId && clientQ.trim().length === 0 && (
              <button type="button" className="crm-btn zn-create-client-link" onClick={startCreateNew}>
                + Новый клиент
              </button>
            )}
          </>
        )}

        {createNew && (
          <div className="zn-new-client">
            <div className="zn-new-client__head">
              <strong>Новый клиент</strong>
              <button
                type="button"
                className="crm-btn crm-btn-ghost"
                onClick={() => {
                  setCreateNew(false);
                  setLastName("");
                  setFirstName("");
                  setMiddleName("");
                  setPhone("");
                }}
              >
                ← К поиску
              </button>
            </div>
            <div className="zn-grid">
              <label className="zn-field">
                <span>Фамилия *</span>
                <input value={lastName} onChange={(e) => setLastName(e.target.value)} autoFocus />
              </label>
              <label className="zn-field">
                <span>Имя *</span>
                <input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </label>
              <label className="zn-field zn-field--wide">
                <span>Отчество</span>
                <input
                  value={middleName}
                  onChange={(e) => setMiddleName(e.target.value)}
                  placeholder="по желанию"
                />
              </label>
              <label className="zn-field zn-field--wide">
                <span>Телефон *</span>
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+7 …"
                  inputMode="tel"
                />
              </label>
            </div>
          </div>
        )}

        <label className="zn-field zn-field--wide">
          <span>Причина обращения *</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Например: ремонт полного привода"
          />
        </label>

        <div className="zn-modal__actions">
          <button type="button" className="crm-btn" onClick={onClose} disabled={busy}>
            Отмена
          </button>
          <button
            type="button"
            className="crm-btn crm-btn-primary"
            onClick={submit}
            disabled={busy || !canSubmit}
          >
            {busy ? "Создаём…" : createNew ? "Создать клиента и ЗН" : "Создать ЗН"}
          </button>
        </div>
      </div>
    </div>
  );
}
