import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { apiFetch } from "../lib/fetch-api";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

type Role = { id: number; name: string; slug: string; isActive?: boolean; sortOrder?: number };
type Rule = {
  id: number;
  roleId: number | null;
  userId: number | null;
  sourceType: string;
  calcType: string;
  value: number;
  label: string;
  isActive?: boolean;
};
type UserRow = { id: number; name: string; role: string; payrollRoleId?: number | null };
type CalcRow = {
  id: number;
  userId: number;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  createdAt: string;
};

function monthValue(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(n: number) {
  return `${(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("ru-RU");
}

export default function PayrollPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [section, setSection] = useState<"calc" | "rates" | "history">("calc");
  const [userId, setUserId] = useState<number | "">("");
  const [periodMonth, setPeriodMonth] = useState(monthValue());
  const [roleId, setRoleId] = useState<number | "">("");
  const [preview, setPreview] = useState<any>(null);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [rateDraft, setRateDraft] = useState<Record<number, string>>({});
  const [roleNameDraft, setRoleNameDraft] = useState("");

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch<{ users: UserRow[] }>("/api/users"),
    enabled: isAdmin,
  });

  const { data: rolesData } = useQuery({
    queryKey: ["payroll-roles"],
    queryFn: () => apiFetch<{ roles: Role[] }>("/api/payroll/roles"),
    enabled: isAdmin,
  });

  const { data: rulesData } = useQuery({
    queryKey: ["payroll-rules", selectedRoleId],
    queryFn: () =>
      apiFetch<{ rules: Rule[]; sourceLabels: Record<string, string> }>("/api/payroll/rules", {
        query: selectedRoleId ? { roleId: String(selectedRoleId) } : {},
      }),
    enabled: isAdmin && section === "rates",
  });

  const { data: calcsData, isLoading: calcsLoading } = useQuery({
    queryKey: ["payroll-calculations", userId],
    queryFn: () =>
      apiFetch<{ calculations: CalcRow[] }>("/api/payroll/calculations", {
        query: userId ? { userId: String(userId) } : {},
      }),
    enabled: isAdmin && section === "history",
  });

  const users = usersData?.users || [];
  const roles = rolesData?.roles || [];
  const rules = (rulesData?.rules || []).filter((r) => !selectedRoleId || r.roleId === selectedRoleId);
  const sourceLabels = rulesData?.sourceLabels || {};

  useEffect(() => {
    if (!selectedRoleId && roles[0]) setSelectedRoleId(roles[0].id);
  }, [roles, selectedRoleId]);

  useEffect(() => {
    const role = roles.find((r) => r.id === selectedRoleId);
    setRoleNameDraft(role?.name || "");
    const next: Record<number, string> = {};
    for (const r of rules) next[r.id] = String(r.value);
    setRateDraft(next);
  }, [selectedRoleId, roles, rulesData]);

  const seedMutation = useMutation({
    mutationFn: () => apiFetch("/api/payroll/seed-defaults", { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-roles"] });
      qc.invalidateQueries({ queryKey: ["payroll-rules"] });
      toast("Должности и ставки по умолчанию созданы", "success");
    },
    onError: (e: Error) => toast(e.message || "Ошибка", "error"),
  });

  const assignRoleMutation = useMutation({
    mutationFn: (payload: { id: number; payrollRoleId: number | null }) =>
      apiFetch(`/api/users/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payrollRoleId: payload.payrollRoleId }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast("Должность сотрудника сохранена", "success");
    },
    onError: (e: Error) => toast(e.message || "Ошибка", "error"),
  });

  const saveRatesMutation = useMutation({
    mutationFn: () => {
      if (!selectedRoleId) throw new Error("Выберите должность");
      return apiFetch(`/api/payroll/roles/${selectedRoleId}/rates`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: roleNameDraft.trim() || undefined,
          rules: Object.entries(rateDraft).map(([id, value]) => ({
            id: Number(id),
            value: Number(String(value).replace(",", ".")),
          })),
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["payroll-roles"] });
      qc.invalidateQueries({ queryKey: ["payroll-rules"] });
      toast("Ставки сохранены", "success");
    },
    onError: (e: Error) => toast(e.message || "Ошибка", "error"),
  });

  const calcMutation = useMutation({
    mutationFn: (save: boolean) => {
      if (!userId) throw new Error("Выберите сотрудника");
      return apiFetch<any>("/api/payroll/calculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          periodMonth,
          roleId: roleId || undefined,
          save,
          finalize: save,
        }),
      });
    },
    onSuccess: (data, save) => {
      setPreview(data);
      if (save) {
        qc.invalidateQueries({ queryKey: ["payroll-calculations"] });
        toast("Расчёт сохранён", "success");
      }
    },
    onError: (e: Error) => toast(e.message || "Ошибка расчёта", "error"),
  });

  const selectedUser = useMemo(() => users.find((u) => u.id === userId), [users, userId]);

  if (!isAdmin) {
    return (
      <AppShell>
        <div style={{ padding: 24 }}>
          <h1 style={{ fontFamily: "Poppins", fontSize: 18, marginBottom: 8 }}>Расчёт ЗП</h1>
          <p style={{ color: "var(--text-muted)" }}>Доступно только администратору. Свою зарплату смотрите в «Моя зарплата».</p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div style={{ padding: 24, overflow: "auto", flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "Poppins", fontSize: 18, fontWeight: 600 }}>Расчёт ЗП сотрудников</h1>
          <div style={{ display: "flex", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            {(
              [
                ["calc", "Расчёт"],
                ["rates", "Должности и ставки"],
                ["history", "История"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`chip${section === id ? " active" : ""}`}
                onClick={() => setSection(id)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {section === "calc" && (
          <div style={{ display: "grid", gap: 16, maxWidth: 960 }}>
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              }}
            >
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                Сотрудник
                <select
                  className="crm-input"
                  value={userId}
                  onChange={(e) => {
                    const id = e.target.value ? Number(e.target.value) : "";
                    setUserId(id);
                    const u = users.find((x) => x.id === id);
                    setRoleId(u?.payrollRoleId || "");
                    setPreview(null);
                  }}
                >
                  <option value="">Выберите…</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                Месяц
                <input
                  className="crm-input"
                  type="month"
                  value={periodMonth}
                  onChange={(e) => {
                    setPeriodMonth(e.target.value);
                    setPreview(null);
                  }}
                />
              </label>
              <label style={{ display: "grid", gap: 6, fontSize: 13 }}>
                Должность для расчёта
                <select className="crm-input" value={roleId} onChange={(e) => setRoleId(e.target.value ? Number(e.target.value) : "")}>
                  <option value="">Как у сотрудника</option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <div style={{ display: "flex", alignItems: "end", gap: 8, flexWrap: "wrap" }}>
                <button type="button" className="crm-btn crm-btn-ghost" disabled={!userId || calcMutation.isPending} onClick={() => calcMutation.mutate(false)}>
                  Предпросмотр
                </button>
                <button type="button" className="crm-btn" disabled={!userId || calcMutation.isPending} onClick={() => calcMutation.mutate(true)}>
                  Рассчитать и сохранить
                </button>
              </div>
            </div>

            {selectedUser && (
              <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
                Текущая должность в карточке:{" "}
                <strong style={{ color: "var(--text)" }}>
                  {roles.find((r) => r.id === selectedUser.payrollRoleId)?.name || "не назначена"}
                </strong>
                <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select
                    className="crm-input"
                    style={{ maxWidth: 260 }}
                    value={selectedUser.payrollRoleId || ""}
                    onChange={(e) =>
                      assignRoleMutation.mutate({
                        id: selectedUser.id,
                        payrollRoleId: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  >
                    <option value="">Без должности ЗП</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                  <span>Назначить сотруднику постоянно</span>
                </div>
              </div>
            )}

            {preview && (
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{preview.userName || selectedUser?.name || "Сотрудник"}</div>
                    <div style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      {preview.preview ? "Предпросмотр" : "Сохранено"} · итог {money(preview.totalAmount ?? preview.report?.periodTotal ?? 0)}
                    </div>
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 700, color: "var(--accent)" }}>
                    {money(preview.totalAmount ?? preview.report?.periodTotal ?? 0)}
                  </div>
                </div>
                {preview.report?.summary && (
                  <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 13, marginBottom: 12 }}>
                    <span>Смены: {money(preview.report.summary.shiftTotal || 0)}</span>
                    <span>Комиссии: {money(preview.report.summary.commissionTotal || 0)}</span>
                  </div>
                )}
                <div style={{ display: "grid", gap: 8, maxHeight: 420, overflow: "auto" }}>
                  {(preview.report?.days || [])
                    .filter((d: any) => d.dayTotal > 0 || d.worked)
                    .map((d: any) => (
                      <div key={d.date} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                          <strong>{d.date}</strong>
                          <span>{money(d.dayTotal)}</span>
                        </div>
                        {d.shiftPay > 0 && (
                          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>Смена: {money(d.shiftPay)}</div>
                        )}
                        {(d.lines || []).map((line: any, idx: number) => (
                          <div key={idx} style={{ color: "var(--text-muted)", fontSize: 12 }}>
                            {line.sourceLabel || line.sourceType}: {money(line.amount)}
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </div>
            )}
          </div>
        )}

        {section === "rates" && (
          <div style={{ display: "grid", gap: 16, maxWidth: 900 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="crm-btn crm-btn-ghost" onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
                Создать должности по умолчанию
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {roles.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className={`chip${selectedRoleId === r.id ? " active" : ""}`}
                  onClick={() => setSelectedRoleId(r.id)}
                >
                  {r.name}
                </button>
              ))}
              {!roles.length && <span style={{ color: "var(--text-muted)" }}>Должностей пока нет — нажмите «Создать по умолчанию»</span>}
            </div>
            {selectedRoleId && (
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
                <label style={{ display: "grid", gap: 6, fontSize: 13, marginBottom: 12, maxWidth: 360 }}>
                  Название должности
                  <input className="crm-input" value={roleNameDraft} onChange={(e) => setRoleNameDraft(e.target.value)} />
                </label>
                <div style={{ display: "grid", gap: 10 }}>
                  {rules.map((rule) => (
                    <div key={rule.id} style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px", gap: 8, alignItems: "center" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{rule.label || sourceLabels[rule.sourceType] || rule.sourceType}</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {rule.calcType === "fixed" ? "фикс, ₽" : "% от базы"}
                        </div>
                      </div>
                      <input
                        className="crm-input"
                        value={rateDraft[rule.id] ?? ""}
                        onChange={(e) => setRateDraft((prev) => ({ ...prev, [rule.id]: e.target.value }))}
                      />
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{rule.calcType === "fixed" ? "₽" : "%"}</span>
                    </div>
                  ))}
                  {!rules.length && <div style={{ color: "var(--text-muted)" }}>Ставок нет — создайте должности по умолчанию.</div>}
                </div>
                <button
                  type="button"
                  className="crm-btn"
                  style={{ marginTop: 16 }}
                  disabled={saveRatesMutation.isPending}
                  onClick={() => saveRatesMutation.mutate()}
                >
                  Сохранить ставки
                </button>
              </div>
            )}
          </div>
        )}

        {section === "history" && (
          <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
            <div style={{ padding: 12, borderBottom: "1px solid var(--border)", display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Фильтр:</span>
              <select className="crm-input" style={{ maxWidth: 260 }} value={userId} onChange={(e) => setUserId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Все сотрудники</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            {calcsLoading ? (
              <div style={{ padding: 16, color: "var(--text-muted)" }}>Загрузка…</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                    <th style={{ padding: "10px 12px" }}>Сотрудник</th>
                    <th style={{ padding: "10px 12px" }}>Период</th>
                    <th style={{ padding: "10px 12px" }}>Статус</th>
                    <th style={{ padding: "10px 12px" }}>Сумма</th>
                    <th style={{ padding: "10px 12px" }}>Создан</th>
                  </tr>
                </thead>
                <tbody>
                  {(calcsData?.calculations || []).map((c) => (
                    <tr key={c.id} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "10px 12px" }}>{users.find((u) => u.id === c.userId)?.name || `#${c.userId}`}</td>
                      <td style={{ padding: "10px 12px" }}>
                        {formatDate(c.periodStart)} — {formatDate(c.periodEnd)}
                      </td>
                      <td style={{ padding: "10px 12px" }}>{c.status}</td>
                      <td style={{ padding: "10px 12px" }}>{money(c.totalAmount)}</td>
                      <td style={{ padding: "10px 12px" }}>{formatDate(c.createdAt)}</td>
                    </tr>
                  ))}
                  {!calcsData?.calculations?.length && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16, color: "var(--text-muted)" }}>
                        Сохранённых расчётов пока нет
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
