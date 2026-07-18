import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { AppShell } from "../components/AppShell";
import { StoModuleTabs } from "../components/StoModuleTabs";
import { QuickReceiptPos } from "../components/sales/QuickReceiptPos";
import { SalesDocumentModal } from "../components/sales/SalesDocumentModal";
import { apiFetch } from "../lib/fetch-api";
import { useToast } from "../lib/toast";
import {
  formatDocDate,
  formatMoney,
  salesDocStatusClass,
  salesDocStatusLabel,
  salesDocTypeLabel,
  type SalesDocument,
} from "../lib/sales-documents";

export default function SalesPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const searchParams = useSearch();
  const createRef = useRef<HTMLDivElement>(null);

  const [search, setSearch] = useState("");
  const [docType, setDocType] = useState("");
  const [status, setStatus] = useState("");
  const [enterpriseId, setEnterpriseId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [quickReceiptOpen, setQuickReceiptOpen] = useState(false);
  const [openDocId, setOpenDocId] = useState<number | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(searchParams);
    const docRaw = params.get("doc");
    if (docRaw) {
      const id = parseInt(docRaw, 10);
      if (!Number.isNaN(id)) setOpenDocId(id);
    }
  }, [searchParams]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (createRef.current && !createRef.current.contains(e.target as Node)) setCreateOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["sales-docs", search, docType, status, enterpriseId],
    queryFn: () =>
      apiFetch<{ documents: SalesDocument[] }>("/api/sales", {
        query: {
          ...(search ? { search } : {}),
          ...(docType ? { docType } : {}),
          ...(status ? { status } : {}),
          ...(enterpriseId ? { enterpriseId } : {}),
        },
      }),
  });

  const { data: enterprisesData } = useQuery({
    queryKey: ["crm-enterprises"],
    queryFn: () => apiFetch<{ enterprises: Array<{ id: number; name: string }> }>("/api/crm-settings/enterprises"),
  });

  const createInvoiceMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ doc: SalesDocument }>("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ docType: "invoice" }),
      }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["sales-docs"] });
      setOpenDocId(res.doc.id);
      setLocation(`/sales?doc=${res.doc.id}`);
      toast("Накладная создана", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      fetch(new URL(`/api/sales/${id}`, window.location.origin).toString(), {
        method: "DELETE",
        credentials: "include",
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Ошибка ${res.status}`);
        }
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sales-docs"] });
      toast("Документ удалён", "info");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const documents = data?.documents || [];
  const enterprises = enterprisesData?.enterprises || [];

  const openDocument = (id: number) => {
    setOpenDocId(id);
    setLocation(`/sales?doc=${id}`);
  };

  const closeDocument = () => {
    setOpenDocId(null);
    setLocation("/sales");
  };

  return (
    <AppShell hideTopBar fullWidth>
      <StoModuleTabs />

      <div className="sales-page-header">
        <div className="sales-page-header__main">
          <div className="sales-page-header__create" ref={createRef}>
            <button
              type="button"
              className="crm-btn crm-btn-icon sales-create-btn"
              title="Создать документ"
              onClick={() => setCreateOpen((v) => !v)}
            >
              +
            </button>
            {createOpen && (
              <div className="sales-create-menu">
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    setQuickReceiptOpen(true);
                  }}
                >
                  Товарный чек
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    createInvoiceMutation.mutate();
                  }}
                >
                  Расходная накладная
                </button>
              </div>
            )}
          </div>
          <div>
            <h1 className="page-title">Реализация</h1>
            <p className="sales-page-subtitle">
              Товарный чек для быстрой продажи. Расходная накладная для отгрузки с получателем.
            </p>
          </div>
        </div>
        <input
          className="crm-input sales-page-search"
          placeholder="Поиск по номеру, получателю, прим…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="sales-filters">
        <div className="filter-row">
          {[
            { id: "", label: "Все типы" },
            { id: "receipt", label: "Товарные чеки" },
            { id: "invoice", label: "Расходные накладные" },
          ].map((chip) => (
            <button
              key={chip.id || "all-types"}
              type="button"
              className={`chip${docType === chip.id ? " active" : ""}`}
              onClick={() => setDocType(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="filter-row">
          {[
            { id: "", label: "Все статусы" },
            { id: "draft", label: "Черновики" },
            { id: "posted", label: "Проведённые" },
            { id: "cancelled", label: "Отменённые" },
          ].map((chip) => (
            <button
              key={chip.id || "all-status"}
              type="button"
              className={`chip${status === chip.id ? " active" : ""}`}
              onClick={() => setStatus(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        {enterprises.length > 0 && (
          <div className="filter-row">
            <button
              type="button"
              className={`chip${!enterpriseId ? " active" : ""}`}
              onClick={() => setEnterpriseId("")}
            >
              Все СТО
            </button>
            {enterprises.map((ent) => (
              <button
                key={ent.id}
                type="button"
                className={`chip${enterpriseId === String(ent.id) ? " active" : ""}`}
                onClick={() => setEnterpriseId(String(ent.id))}
              >
                {ent.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="page-body" style={{ paddingTop: 0 }}>
        <div style={{ overflow: "auto", maxHeight: "calc(100vh - 260px)" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>№</th>
                <th>Тип</th>
                <th>Дата</th>
                <th>ЗН</th>
                <th>Получатель</th>
                <th>Примечание</th>
                <th>Сумма</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--text-muted)" }}>
                    Загрузка…
                  </td>
                </tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--text-muted)", padding: 32 }}>
                    Документов пока нет — нажмите «+» слева и создайте товарный чек или накладную
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id}>
                    <td style={{ fontWeight: 700 }}>{doc.docNumber}</td>
                    <td>{salesDocTypeLabel(doc.docType)}</td>
                    <td>{formatDocDate(doc.postedAt || doc.createdAt)}</td>
                    <td>{doc.dealId ? `#${doc.dealId}` : "—"}</td>
                    <td>{doc.recipientName || doc.clientName || "—"}</td>
                    <td style={{ color: "var(--text-muted)", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {doc.notes || "—"}
                    </td>
                    <td>{formatMoney(doc.totalAmount)}</td>
                    <td>
                      <span className={salesDocStatusClass(doc.status)}>{salesDocStatusLabel(doc.status)}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => openDocument(doc.id)}>
                          Открыть
                        </button>
                        {(doc.status === "draft" || doc.status === "cancelled") && (
                          <button
                            type="button"
                            className="crm-btn crm-btn-ghost crm-btn-sm"
                            style={{ color: "var(--danger)" }}
                            onClick={() => {
                              const msg = doc.status === "cancelled"
                                ? "Удалить отменённый документ?"
                                : "Удалить черновик?";
                              if (window.confirm(msg)) deleteMutation.mutate(doc.id);
                            }}
                          >
                            Удалить
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {quickReceiptOpen && (
        <QuickReceiptPos
          onClose={() => setQuickReceiptOpen(false)}
          onPosted={(id) => {
            refetch();
            openDocument(id);
          }}
        />
      )}

      {openDocId != null && (
        <SalesDocumentModal
          documentId={openDocId}
          onClose={closeDocument}
          onChanged={() => refetch()}
        />
      )}
    </AppShell>
  );
}
