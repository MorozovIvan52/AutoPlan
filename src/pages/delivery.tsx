import { useState, useEffect } from "react";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { useLocation, useSearch } from "wouter";

import { apiFetch } from "../lib/fetch-api";

import { AppShell } from "../components/AppShell";

import { useToast } from "../lib/toast";

type ShipmentPhase = "created" | "accepted" | "in_transit" | "at_pvz" | "delivered" | "unknown" | "";

type Shipment = {

  dealId: number;

  title: string;

  status: string;

  clientId: number;

  conversationId: number | null;

  clientName: string;

  clientPhone: string | null;

  cdekTrackNumber: string | null;

  cdekImNumber: string | null;

  cdekProductName: string | null;

  cdekPvzAddress: string | null;

  cdekStatus: string | null;

  cdekDeliveryCost: number | null;

  phase: ShipmentPhase;

  phaseLabel: string;

  statusLabel: string;

  trackingUrl: string | null;

  updatedAt: string | null;

};

const PHASE_FILTERS: { id: ShipmentPhase; label: string }[] = [

  { id: "", label: "Все" },

  { id: "accepted", label: "Сдан / принят" },

  { id: "in_transit", label: "В пути" },

  { id: "at_pvz", label: "Готов к выдаче" },

  { id: "delivered", label: "Вручено" },

];

function phaseColor(phase: ShipmentPhase): string {

  if (phase === "at_pvz") return "var(--warning)";

  if (phase === "delivered") return "var(--success)";

  if (phase === "in_transit") return "var(--accent)";

  if (phase === "accepted" || phase === "created") return "#06b6d4";

  return "var(--text-muted)";

}

function formatDate(iso: string | null): string {

  if (!iso) return "—";

  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

}

export default function DeliveryPage() {

  const qc = useQueryClient();

  const { toast } = useToast();

  const [, setLocation] = useLocation();
  const searchParams = useSearch();

  const [search, setSearch] = useState("");

  const [phase, setPhase] = useState<ShipmentPhase>("");

  useEffect(() => {
    const p = new URLSearchParams(searchParams).get("phase") as ShipmentPhase | null;
    if (p && ["created", "accepted", "in_transit", "at_pvz", "delivered", "unknown"].includes(p)) {
      setPhase(p);
    }
  }, [searchParams]);

  const [refreshingId, setRefreshingId] = useState<number | null>(null);

  const [syncing, setSyncing] = useState(true);

  useEffect(() => {

    let cancelled = false;

    (async () => {

      try {

        await apiFetch("/api/cdek/shipments", { query: { sync: "1" } });

        if (!cancelled) qc.invalidateQueries({ queryKey: ["cdek-shipments"] });

      } catch {

        /* СДЭК может быть не настроен */

      } finally {

        if (!cancelled) setSyncing(false);

      }

    })();

    return () => { cancelled = true; };

  }, [qc]);

  const { data, isLoading } = useQuery({

    queryKey: ["cdek-shipments", search, phase],

    queryFn: async () => {

      const q: Record<string, string> = {};

      if (search.trim()) q.q = search.trim();

      if (phase) q.phase = phase;

      return apiFetch<{ shipments: Shipment[]; count: number; counts: Record<string, number> }>("/api/cdek/shipments", { query: q });

    },

    refetchInterval: 120000,

    enabled: !syncing,

  });

  const refreshOneMutation = useMutation({

    mutationFn: async (dealId: number) => {

      setRefreshingId(dealId);

      return apiFetch("/api/cdek/shipments/refresh", {

        method: "POST",

        headers: { "Content-Type": "application/json" },

        body: JSON.stringify({ dealId }),

      });

    },

    onSuccess: () => {

      qc.invalidateQueries({ queryKey: ["cdek-shipments"] });

      toast("Статус обновлён", "success");

    },

    onError: (e: Error) => toast(e.message, "error"),

    onSettled: () => setRefreshingId(null),

  });

  const refreshAllMutation = useMutation({

    mutationFn: async () => apiFetch<{ refreshed: number; total: number }>("/api/cdek/shipments/refresh", {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({}),

    }),

    onSuccess: (res) => {

      qc.invalidateQueries({ queryKey: ["cdek-shipments"] });

      toast(`Обновлено ${res.refreshed} из ${res.total}`, "success");

    },

    onError: (e: Error) => toast(e.message, "error"),

  });

  const shipments = data?.shipments || [];

  const counts = data?.counts;

  const loading = syncing || isLoading;

  return (

    <AppShell hideTopBar>

      <div className="page-header">

        <h1 className="page-title">🚚 Доставка СДЭК</h1>

        <input

          className="crm-input"

          placeholder="Трек, клиент, заказ, ПВЗ..."

          value={search}

          onChange={(e) => setSearch(e.target.value)}

          style={{ width: 260, height: 34 }}

        />

        <button

          type="button"

          className="crm-btn crm-btn-sm"

          disabled={refreshAllMutation.isPending || syncing}

          onClick={() => refreshAllMutation.mutate()}

        >

          {refreshAllMutation.isPending || syncing ? "Обновление…" : "Обновить все"}

        </button>

      </div>

      <div className="page-body">

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>

          {PHASE_FILTERS.map((f) => {

            const cnt = f.id === "" ? counts?.total : counts?.[f.id];

            return (

              <button

                key={f.id || "all"}

                type="button"

                className={`crm-btn crm-btn-sm${phase === f.id ? "" : " crm-btn-ghost"}`}

                onClick={() => setPhase(f.id)}

              >

                {f.label}

                {cnt != null && <span style={{ marginLeft: 6, opacity: 0.7 }}>({cnt})</span>}

              </button>

            );

          })}

        </div>

        {loading ? (

          <p style={{ color: "var(--text-muted)" }}>{syncing ? "Запрос актуальных статусов у СДЭК…" : "Загрузка накладных…"}</p>

        ) : shipments.length === 0 ? (

          <div className="crm-card" style={{ padding: 32, textAlign: "center", borderRadius: 12 }}>

            <div style={{ fontSize: 40, marginBottom: 8 }}>📦</div>

            <p style={{ fontWeight: 600 }}>Накладных пока нет</p>

            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>

              Создайте отправление в карточке заказа — оно появится здесь

            </p>

            <button type="button" className="crm-btn crm-btn-sm" style={{ marginTop: 12 }} onClick={() => setLocation("/deals")}>

              К заказам

            </button>

          </div>

        ) : (

          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 220px)" }}>

            <table className="data-table">

              <thead>

                <tr>

                  <th>Трек-номер</th>

                  <th>Клиент</th>

                  <th>Заказ / товар</th>

                  <th>ПВЗ</th>

                  <th>Статус</th>

                  <th>Обновлено</th>

                  <th></th>

                </tr>

              </thead>

              <tbody>

                {shipments.map((s) => (

                  <tr key={s.dealId}>

                    <td>

                      {s.cdekTrackNumber ? (

                        <a href={s.trackingUrl || "#"} target="_blank" rel="noopener noreferrer" style={{ fontWeight: 600, color: "var(--accent)" }}>

                          {s.cdekTrackNumber}

                        </a>

                      ) : (

                        <span style={{ color: "var(--text-muted)" }}>{s.cdekImNumber || "—"}</span>

                      )}

                    </td>

                    <td>

                      <div style={{ fontWeight: 500 }}>{s.clientName}</div>

                      {s.clientPhone && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{s.clientPhone}</div>}

                    </td>

                    <td>

                      <button

                        type="button"

                        className="crm-btn crm-btn-sm crm-btn-ghost"

                        style={{ padding: "2px 6px", fontWeight: 500 }}

                        onClick={() => setLocation(`/deals?deal=${s.dealId}`)}

                      >

                        {s.title || `Заказ #${s.dealId}`}

                      </button>

                      {s.cdekProductName && (

                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{s.cdekProductName}</div>

                      )}

                    </td>

                    <td style={{ maxWidth: 200, fontSize: 12 }}>{s.cdekPvzAddress || "—"}</td>

                    <td>

                      <span style={{ fontSize: 12, fontWeight: 600, color: phaseColor(s.phase) }}>

                        {s.statusLabel || s.phaseLabel}

                      </span>

                      {s.cdekStatus && s.cdekStatus !== s.statusLabel && (

                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{s.cdekStatus}</div>

                      )}

                    </td>

                    <td style={{ fontSize: 12, color: "var(--text-muted)", whiteSpace: "nowrap" }}>

                      {formatDate(s.updatedAt)}

                    </td>

                    <td>

                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>

                        <button

                          type="button"

                          className="crm-btn crm-btn-sm crm-btn-ghost"

                          style={{ padding: "4px 8px", minWidth: 32 }}

                          disabled={refreshingId === s.dealId}

                          onClick={() => refreshOneMutation.mutate(s.dealId)}

                          title="Обновить статус"

                        >

                          {refreshingId === s.dealId ? "…" : "↻"}

                        </button>

                        {s.conversationId && (

                          <button

                            type="button"

                            className="crm-btn crm-btn-sm crm-btn-ghost"

                            style={{ padding: "4px 8px", minWidth: 32 }}

                            onClick={() => setLocation(`/?conv=${s.conversationId}`)}

                            title="Чат с клиентом"

                          >

                            💬

                          </button>

                        )}

                        {s.trackingUrl && (

                          <a

                            href={s.trackingUrl}

                            target="_blank"

                            rel="noopener noreferrer"

                            className="crm-btn crm-btn-sm crm-btn-ghost"

                            style={{ padding: "4px 8px", minWidth: 32, textDecoration: "none" }}

                            title="На cdek.ru"

                          >

                            🔗

                          </a>

                        )}

                      </div>

                    </td>

                  </tr>

                ))}

              </tbody>

            </table>

          </div>

        )}

      </div>

    </AppShell>

  );

}

