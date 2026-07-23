import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { AppShell } from "../components/AppShell";
import { ZnWorkbench } from "../components/zn/ZnWorkbench";
import { ZnCreateModal } from "../components/zn/ZnCreateModal";
import { apiFetch } from "../lib/fetch-api";
import { dealStatusLabel, formatFullTime } from "../lib/utils";
import { useOpenTabs } from "../lib/open-tabs";

type DealRow = {
  id: number;
  title: string | null;
  status: string;
  amount: number | null;
  clientName?: string;
  updatedAt?: string;
  createdAt?: string;
};

export default function ZnPage() {
  const [, params] = useRoute("/zn/:id");
  const dealId = params?.id ? parseInt(params.id, 10) : null;
  const [, setLocation] = useLocation();
  const { openTab } = useOpenTabs();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["zn-list"],
    queryFn: () =>
      apiFetch<{ deals: DealRow[] }>("/api/deals", {
        query: { orderType: "service", limit: "200" },
      }),
  });

  const deals = useMemo(() => {
    const list = data?.deals || [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter(
      (d) =>
        String(d.id).includes(s) ||
        (d.title || "").toLowerCase().includes(s) ||
        (d.clientName || "").toLowerCase().includes(s),
    );
  }, [data?.deals, q]);

  if (dealId && !Number.isNaN(dealId)) {
    return (
      <AppShell hideTopBar title={`ЗН № ${dealId}`}>
        <ZnWorkbench dealId={dealId} />
      </AppShell>
    );
  }

  return (
    <AppShell hideTopBar title="Заказ-наряды">
      <div className="zn-list-page">
        <div className="zn-list-head zn-list-head--sticky">
          <h1 className="page-title">Заказ-наряды</h1>
          <div className="zn-list-tools">
            <button
              type="button"
              className="crm-btn crm-btn-primary zn-create-btn"
              data-testid="zn-create-btn"
              onClick={() => setCreateOpen(true)}
            >
              + Создать ЗН
            </button>
            <select className="zn-select" defaultValue="all" aria-label="Фильтр">
              <option value="all">Везде</option>
            </select>
            <input
              className="zn-search"
              placeholder="Поиск"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
        <div className="zn-create-banner">
          <span>Новый заказ-наряд: клиент → причина → карточка с СТС, работами, актом осмотра</span>
          <button
            type="button"
            className="crm-btn crm-btn-primary zn-create-btn"
            data-testid="zn-create-btn-banner"
            onClick={() => setCreateOpen(true)}
          >
            + Создать ЗН
          </button>
        </div>

        {isLoading ? (
          <p className="zn-muted">Загрузка…</p>
        ) : (
          <div className="zn-list-table-wrap">
            <table className="zn-table zn-table--list">
              <thead>
                <tr>
                  <th>№</th>
                  <th>Клиент / тема</th>
                  <th>Статус</th>
                  <th>Сумма</th>
                  <th>Обновлён</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr
                    key={d.id}
                    className="zn-row-click"
                    onClick={() => {
                      openTab(`/zn/${d.id}`, `ЗН № ${d.id}`);
                      setLocation(`/zn/${d.id}`);
                    }}
                  >
                    <td>ЗН-{d.id}</td>
                    <td>
                      <div className="zn-strong">{d.clientName || "—"}</div>
                      <div className="zn-muted">{d.title || "Без названия"}</div>
                    </td>
                    <td>
                      <span className="zn-badge">{dealStatusLabel(d.status)}</span>
                    </td>
                    <td>{Math.round(Number(d.amount) || 0).toLocaleString("ru-RU")} ₽</td>
                    <td className="zn-muted">{formatFullTime(d.updatedAt || d.createdAt || "")}</td>
                  </tr>
                ))}
                {deals.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="zn-empty">
                        <p className="zn-muted">Нет заказ-нарядов</p>
                        <button
                          type="button"
                          className="crm-btn crm-btn-primary"
                          onClick={() => setCreateOpen(true)}
                        >
                          + Создать ЗН
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <button
        type="button"
        className="zn-fab-create"
        data-testid="zn-create-fab"
        title="Создать ЗН"
        onClick={() => setCreateOpen(true)}
      >
        + ЗН
      </button>

      <ZnCreateModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => {
          void qc.invalidateQueries({ queryKey: ["zn-list"] });
          openTab(`/zn/${id}`, `ЗН № ${id}`);
          setLocation(`/zn/${id}`);
        }}
      />
    </AppShell>
  );
}
