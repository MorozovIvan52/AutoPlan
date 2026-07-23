import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../lib/fetch-api";
import { AppShell } from "../components/AppShell";
import { useToast } from "../lib/toast";

type Buyout = {
  id: number;
  title: string;
  article: string | null;
  shop: string | null;
  amount: number;
  notes: string | null;
  boughtAt: string;
};

function monthValue(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function toInputDate(iso: string | Date) {
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

function formatMoney(n: number) {
  return `${n.toLocaleString("ru-RU")} ₽`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function BuyoutsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [month, setMonth] = useState(monthValue());
  const [search, setSearch] = useState("");
  const [form, setForm] = useState({
    title: "",
    article: "",
    shop: "",
    amount: "",
    boughtAt: toInputDate(new Date()),
    notes: "",
  });
  const [editId, setEditId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ title: "", article: "", shop: "", amount: "", boughtAt: "", notes: "" });

  const { data: summary } = useQuery({
    queryKey: ["buyouts-summary", month],
    queryFn: () => apiFetch<{ total: number; count: number; label: string }>("/api/buyouts/summary", { query: { month } }),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["buyouts", month, search],
    queryFn: () => {
      const q: Record<string, string> = { month };
      if (search.trim()) q.q = search.trim();
      return apiFetch<{ buyouts: Buyout[] }>("/api/buyouts", { query: q });
    },
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["buyouts"] });
    qc.invalidateQueries({ queryKey: ["buyouts-summary"] });
  };

  const createMutation = useMutation({
    mutationFn: () => apiFetch("/api/buyouts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.title.trim(),
        article: form.article.trim() || null,
        shop: form.shop.trim() || null,
        amount: parseFloat(form.amount),
        boughtAt: form.boughtAt,
        notes: form.notes.trim() || null,
      }),
    }),
    onSuccess: () => {
      invalidate();
      setForm({ title: "", article: "", shop: "", amount: "", boughtAt: toInputDate(new Date()), notes: "" });
      toast("Выкуп добавлен", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const updateMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/buyouts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: editForm.title.trim(),
        article: editForm.article.trim() || null,
        shop: editForm.shop.trim() || null,
        amount: parseFloat(editForm.amount),
        boughtAt: editForm.boughtAt,
        notes: editForm.notes.trim() || null,
      }),
    }),
    onSuccess: () => {
      invalidate();
      setEditId(null);
      toast("Сохранено", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/buyouts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      toast("Удалено", "info");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const buyouts = data?.buyouts || [];

  const startEdit = (b: Buyout) => {
    setEditId(b.id);
    setEditForm({
      title: b.title,
      article: b.article || "",
      shop: b.shop || "",
      amount: String(b.amount),
      boughtAt: toInputDate(b.boughtAt),
      notes: b.notes || "",
    });
  };

  return (
    <AppShell hideTopBar>
      <div className="page-header">
        <h1 className="page-title">💰 Выкуп</h1>
        <input
          type="month"
          className="crm-input"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          style={{ width: 160, height: 34 }}
        />
        <input
          className="crm-input"
          placeholder="Поиск: название, артикул, магазин..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 260, height: 34 }}
        />
      </div>

      <div className="page-body">
        <div
          className="crm-card"
          style={{
            padding: 20,
            marginBottom: 20,
            borderRadius: 12,
            background: "linear-gradient(135deg, var(--accent-soft), transparent)",
            border: "1px solid var(--border)",
          }}
        >
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 4 }}>Итого за {summary?.label || "месяц"}</p>
          <p style={{ fontSize: 28, fontWeight: 700, color: "var(--accent)" }}>
            {formatMoney(summary?.total || 0)}
          </p>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
            {summary?.count || 0} позиций выкупа
          </p>
        </div>

        <div className="crm-card" style={{ padding: 16, marginBottom: 20, borderRadius: 12 }}>
          <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>+ Добавить выкуп</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 8 }}>
            <input
              className="crm-input"
              placeholder="Что выкупили *"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              style={{ gridColumn: "span 2" }}
            />
            <input className="crm-input" placeholder="Артикул" value={form.article} onChange={(e) => setForm({ ...form, article: e.target.value })} />
            <input className="crm-input" placeholder="Магазин" value={form.shop} onChange={(e) => setForm({ ...form, shop: e.target.value })} />
            <input className="crm-input" placeholder="Сумма ₽ *" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            <input className="crm-input" type="date" value={form.boughtAt} onChange={(e) => setForm({ ...form, boughtAt: e.target.value })} />
            <input className="crm-input" placeholder="Примечание" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ gridColumn: "span 2" }} />
          </div>
          <button
            type="button"
            className="crm-btn crm-btn-sm"
            style={{ marginTop: 10 }}
            disabled={!form.title.trim() || !form.amount || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? "Сохранение…" : "Добавить"}
          </button>
        </div>

        {isLoading ? (
          <p style={{ color: "var(--text-muted)" }}>Загрузка…</p>
        ) : buyouts.length === 0 ? (
          <div className="crm-card" style={{ padding: 32, textAlign: "center", borderRadius: 12 }}>
            <p style={{ fontWeight: 600 }}>Нет записей за выбранный месяц</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6 }}>Добавьте первый выкуп запчастей</p>
          </div>
        ) : (
          <div style={{ overflow: "auto", maxHeight: "calc(100vh - 420px)" }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Наименование</th>
                  <th>Артикул</th>
                  <th>Магазин</th>
                  <th>Сумма</th>
                  <th>Примечание</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {buyouts.map((b) => (
                  <tr key={b.id}>
                    {editId === b.id ? (
                      <>
                        <td><input className="crm-input" type="date" value={editForm.boughtAt} onChange={(e) => setEditForm({ ...editForm, boughtAt: e.target.value })} /></td>
                        <td><input className="crm-input" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} /></td>
                        <td><input className="crm-input" value={editForm.article} onChange={(e) => setEditForm({ ...editForm, article: e.target.value })} /></td>
                        <td><input className="crm-input" value={editForm.shop} onChange={(e) => setEditForm({ ...editForm, shop: e.target.value })} /></td>
                        <td><input className="crm-input" type="number" value={editForm.amount} onChange={(e) => setEditForm({ ...editForm, amount: e.target.value })} /></td>
                        <td><input className="crm-input" value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} /></td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button type="button" className="crm-btn crm-btn-sm" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate(b.id)}>✓</button>
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setEditId(null)}>✕</button>
                          </div>
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ whiteSpace: "nowrap" }}>{formatDate(b.boughtAt)}</td>
                        <td style={{ fontWeight: 500 }}>{b.title}</td>
                        <td style={{ fontFamily: "monospace", fontSize: 12 }}>{b.article || "—"}</td>
                        <td>{b.shop || "—"}</td>
                        <td style={{ fontWeight: 700, color: "var(--success)", whiteSpace: "nowrap" }}>{formatMoney(b.amount)}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 160 }}>{b.notes || "—"}</td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => startEdit(b)}>✏️</button>
                            <button
                              type="button"
                              className="crm-btn crm-btn-ghost crm-btn-sm"
                              style={{ color: "var(--danger)" }}
                              onClick={() => { if (window.confirm("Удалить запись?")) deleteMutation.mutate(b.id); }}
                            >
                              🗑
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 600, textAlign: "right" }}>Итого за месяц:</td>
                  <td style={{ fontWeight: 700, color: "var(--accent)" }}>{formatMoney(summary?.total || 0)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
