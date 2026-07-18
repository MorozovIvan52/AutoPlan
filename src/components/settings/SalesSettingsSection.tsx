import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../../lib/fetch-api";
import { useAuth } from "../../lib/auth";
import { useToast } from "../../lib/toast";
import {
  DEFAULT_PARTS_WARRANTY,
  parseWarrantyTemplates,
  serializeWarrantyTemplates,
  type WarrantyTemplate,
} from "../../lib/warranty-templates";

export function SalesSettingsSection() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [receiptShowArticles, setReceiptShowArticles] = useState(true);
  const [templates, setTemplates] = useState<WarrantyTemplate[]>(DEFAULT_PARTS_WARRANTY);

  const { data } = useQuery({
    queryKey: ["crm-settings"],
    queryFn: () =>
      apiFetch<{
        settings: {
          receiptShowArticles?: boolean | null;
          warrantyTemplates?: string | null;
        };
      }>("/api/crm-settings"),
    enabled: user?.role === "admin",
  });

  useEffect(() => {
    if (!data?.settings) return;
    setReceiptShowArticles(data.settings.receiptShowArticles !== false);
    setTemplates(parseWarrantyTemplates(data.settings.warrantyTemplates));
  }, [data?.settings]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/crm-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          receiptShowArticles,
          warrantyTemplates: serializeWarrantyTemplates(templates.filter((t) => t.title.trim() && t.text.trim())),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
      toast("Настройки реализации сохранены", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  if (user?.role !== "admin") {
    return <p style={{ color: "var(--text-muted)" }}>Доступно только администратору</p>;
  }

  return (
    <>
      <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
        Товарные чеки и реализация
      </h3>
      <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
        Настройки печати товарных чеков и шаблонов гарантии для быстрой продажи.
      </p>

      <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>
        <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: 13, cursor: "pointer", marginBottom: 16 }}>
          <input
            type="checkbox"
            checked={receiptShowArticles}
            onChange={(e) => setReceiptShowArticles(e.target.checked)}
            style={{ marginTop: 3 }}
          />
          <span>
            <strong>Показывать артикулы клиенту</strong>
            <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
              Если выключено, колонка «Артикул» скрывается на печати и в POS-форме товарного чека.
            </span>
          </span>
        </label>

        <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Шаблоны гарантии</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
          {templates.map((tpl, index) => (
            <div key={tpl.id} style={{ display: "grid", gap: 6, gridTemplateColumns: "1fr", padding: 10, border: "1px solid var(--border)", borderRadius: 8 }}>
              <input
                className="crm-input"
                placeholder="Название шаблона"
                value={tpl.title}
                onChange={(e) => {
                  const next = [...templates];
                  next[index] = { ...tpl, title: e.target.value };
                  setTemplates(next);
                }}
              />
              <textarea
                className="crm-input"
                rows={2}
                placeholder="Текст гарантии"
                value={tpl.text}
                onChange={(e) => {
                  const next = [...templates];
                  next[index] = { ...tpl, text: e.target.value };
                  setTemplates(next);
                }}
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="crm-btn crm-btn-ghost crm-btn-sm"
          style={{ marginBottom: 12 }}
          onClick={() =>
            setTemplates((prev) => [
              ...prev,
              { id: `custom-${Date.now()}`, title: "Новый шаблон", text: "" },
            ])
          }
        >
          + Шаблон гарантии
        </button>

        <button type="button" className="crm-btn" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Сохранить
        </button>
      </div>
    </>
  );
}
