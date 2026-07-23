import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { apiFetch } from "../lib/fetch-api";

function monthBounds(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = `${month}-01`;
  const last = new Date(y, m, 0).getDate();
  const to = `${month}-${String(last).padStart(2, "0")}`;
  return { from, to };
}

function monthValue(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function money(n: number) {
  return `${(n || 0).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} ₽`;
}

export default function MySalaryPage() {
  const [month, setMonth] = useState(monthValue());
  const { from, to } = useMemo(() => monthBounds(month), [month]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["payroll-my", from, to],
    queryFn: () =>
      apiFetch<{ report: any }>("/api/payroll/my", {
        query: { from, to },
      }),
  });

  const report = data?.report;

  return (
    <AppShell>
      <div style={{ padding: 24, overflow: "auto", flex: 1, maxWidth: 900 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
          <h1 style={{ fontFamily: "Poppins", fontSize: 18, fontWeight: 600 }}>Моя зарплата</h1>
          <input className="crm-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ maxWidth: 180, marginLeft: "auto" }} />
        </div>

        {isLoading && <div style={{ color: "var(--text-muted)" }}>Загрузка…</div>}
        {error && <div style={{ color: "var(--danger)" }}>{(error as Error).message || "Ошибка загрузки"}</div>}

        {report && (
          <>
            <div
              style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                padding: 16,
                marginBottom: 16,
                display: "flex",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>{report.userName}</div>
                <div style={{ color: "var(--text-muted)", fontSize: 13 }}>{report.positionName || "Должность не назначена"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Итого за период</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--accent)" }}>{money(report.periodTotal)}</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap", fontSize: 13 }}>
              <span>Смены: {money(report.summary?.shiftTotal || 0)}</span>
              <span>Комиссии: {money(report.summary?.commissionTotal || 0)}</span>
            </div>

            <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 16 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>По дням</h3>
              <div style={{ display: "grid", gap: 10 }}>
                {(report.days || [])
                  .filter((d: any) => d.dayTotal > 0 || d.worked)
                  .map((d: any) => (
                    <div key={d.date} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                        <strong>{d.date}</strong>
                        <span>{money(d.dayTotal)}</span>
                      </div>
                      {d.shiftPay > 0 && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Смена: {money(d.shiftPay)}</div>}
                      {(d.lines || []).map((line: any, idx: number) => (
                        <div key={idx} style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {line.sourceLabel || line.sourceType}: {money(line.amount)}
                        </div>
                      ))}
                    </div>
                  ))}
                {!(report.days || []).some((d: any) => d.dayTotal > 0 || d.worked) && (
                  <div style={{ color: "var(--text-muted)", fontSize: 13 }}>За этот месяц начислений нет</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
