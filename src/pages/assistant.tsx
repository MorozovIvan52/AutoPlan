import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../components/AppShell";
import { apiFetch, apiFetchVoid } from "../lib/fetch-api";
import { useToast } from "../lib/toast";
import { channelLabel } from "../lib/utils";

const STAGE_LABELS: Record<string, string> = {
  inbox: "💬 Входящие",
  deal: "📦 Заказы",
  repair: "🔧 Ремонт",
  delivery: "🚚 Доставка",
  parts: "🏭 Склад",
};

const OPP_COLORS: Record<string, string> = {
  hot_lead: "var(--danger)",
  avito_deal: "var(--warning)",
  quote_request: "var(--accent)",
  repair_intent: "#8b5cf6",
  no_reply: "var(--text-muted)",
};

type ChatOpportunity = {
  conversationId: number;
  clientId: number;
  clientName: string;
  channelType: string | null;
  lastMessageAt: string | null;
  lastClientText: string;
  unreadCount: number;
  opportunityType: string;
  opportunityLabel: string;
  score: number;
  reason: string;
  proposedText: string;
  hasActiveDeal: boolean;
  avitoItemTitle?: string | null;
  avitoPrice?: number | null;
};

type Proposal = {
  id: number;
  stage: string;
  title: string;
  reason?: string;
  proposedText: string;
  editedText?: string;
  text: string;
  conversationId?: number;
  clientName?: string;
  priority: number;
};

function formatWhen(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diffH = Math.round((now.getTime() - d.getTime()) / 3600000);
  if (diffH < 1) return "только что";
  if (diffH < 24) return `${diffH} ч. назад`;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

function openChatWithDraft(setLocation: (path: string) => void, convId: number, draft: string) {
  sessionStorage.setItem(`crm-chat-draft-${convId}`, draft);
  setLocation(`/?conv=${convId}`);
}

export default function AssistantPage() {
  const [, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [view, setView] = useState<"chats" | "tasks">("chats");
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("");
  const [autoScan, setAutoScan] = useState(false);
  const [chatEdits, setChatEdits] = useState<Record<number, string>>({});
  const [taskEdits, setTaskEdits] = useState<Record<number, string>>({});
  const [expandedChat, setExpandedChat] = useState<number | null>(null);

  const chatQuery = useQuery({
    queryKey: ["ai-chat-opportunities", search],
    queryFn: () => {
      const q = search.trim() ? `?q=${encodeURIComponent(search.trim())}` : "";
      return apiFetch<{ opportunities: ChatOpportunity[]; count: number }>(`/api/ai/chat-opportunities${q}`);
    },
    refetchInterval: autoScan ? 120000 : false,
  });

  const tasksQuery = useQuery({
    queryKey: ["ai-proposals", stageFilter],
    queryFn: () => {
      const q = stageFilter ? `?status=pending&stage=${stageFilter}` : "?status=pending";
      return apiFetch<{ proposals: Proposal[]; count: number }>(`/api/ai/proposals${q}`);
    },
    enabled: view === "tasks",
  });

  const scanMutation = useMutation({
    mutationFn: () => apiFetch<{ scanned: number; created: number; chatCount: number }>("/api/ai/scan", { method: "POST" }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["ai-chat-opportunities"] });
      qc.invalidateQueries({ queryKey: ["ai-proposals"] });
      qc.invalidateQueries({ queryKey: ["ai-proposals-count"] });
      toast(`Чатов: ${res.chatCount} · новых задач: ${res.created}`, "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const sendChatMutation = useMutation({
    mutationFn: ({ convId, text }: { convId: number; text: string }) =>
      apiFetch(`/api/conversations/${convId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      }),
    onSuccess: (_, vars) => {
      toast("Сообщение отправлено", "success");
      setChatEdits((prev) => { const n = { ...prev }; delete n[vars.convId]; return n; });
      qc.invalidateQueries({ queryKey: ["ai-chat-opportunities"] });
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/ai/proposals/${id}/approve`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-proposals"] });
      qc.invalidateQueries({ queryKey: ["ai-proposals-count"] });
      toast("Отправлено клиенту", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/ai/proposals/${id}/reject`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-proposals"] });
      qc.invalidateQueries({ queryKey: ["ai-proposals-count"] });
    },
  });

  useEffect(() => {
    if (!autoScan) return;
    const t = setInterval(() => scanMutation.mutate(), 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [autoScan]);

  const opportunities = chatQuery.data?.opportunities || [];
  const tasks = tasksQuery.data?.proposals || [];

  const hotCount = useMemo(() => opportunities.filter((o) => o.score >= 60).length, [opportunities]);

  const getChatText = (o: ChatOpportunity) => chatEdits[o.conversationId] ?? o.proposedText;

  return (
    <AppShell title="AI-ассистент">
      <div className="page-body" style={{ maxWidth: 960, margin: "0 auto" }}>
        <div className="crm-card" style={{ padding: 16, marginBottom: 16, borderRadius: 12 }}>
          <h1 className="page-title" style={{ marginBottom: 8 }}>🤖 AI-ассистент</h1>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 12 }}>
            Список чатов с потенциальными сделками. Редактируйте SMS и отправляйте или откройте чат для доработки.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="crm-btn" disabled={scanMutation.isPending} onClick={() => scanMutation.mutate()}>
              {scanMutation.isPending ? "Сканирование..." : "🔍 Обновить чаты и задачи"}
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={autoScan} onChange={(e) => setAutoScan(e.target.checked)} />
              Авто-обновление каждые 5 мин
            </label>
          </div>
        </div>

        <div className="filter-row" style={{ marginBottom: 12 }}>
          <button type="button" className={`chip${view === "chats" ? " active" : ""}`} onClick={() => setView("chats")}>
            💬 Чаты ({opportunities.length}{hotCount > 0 ? ` · 🔥${hotCount}` : ""})
          </button>
          <button type="button" className={`chip${view === "tasks" ? " active" : ""}`} onClick={() => setView("tasks")}>
            📋 Задачи ({tasksQuery.data?.count ?? 0})
          </button>
        </div>

        {view === "chats" && (
          <>
            <input
              className="crm-input"
              placeholder="Поиск по клиенту, сообщению, объявлению Авито..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ marginBottom: 12 }}
            />

            {chatQuery.isLoading ? (
              <p style={{ color: "var(--text-muted)", textAlign: "center" }}>Анализ чатов...</p>
            ) : opportunities.length === 0 ? (
              <div className="crm-card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                <p>Потенциальных чатов не найдено.</p>
                <p style={{ fontSize: 12, marginTop: 8 }}>Нажмите «Обновить» — бот проверит открытые диалоги, Авито и запросы на покупку/ремонт.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {opportunities.map((o) => {
                  const expanded = expandedChat === o.conversationId;
                  const text = getChatText(o);
                  return (
                    <div key={o.conversationId} className="crm-card" style={{ padding: 12, borderRadius: 12 }}>
                      <div
                        style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer" }}
                        onClick={() => setExpandedChat(expanded ? null : o.conversationId)}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
                            <strong style={{ fontSize: 14 }}>{o.clientName}</strong>
                            <span className="chip" style={{ fontSize: 10, color: OPP_COLORS[o.opportunityType] || "inherit" }}>
                              {o.opportunityLabel}
                            </span>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {channelLabel(o.channelType || "manual")}
                            </span>
                            {o.unreadCount > 0 && (
                              <span className="nav-badge" style={{ position: "static" }}>{o.unreadCount}</span>
                            )}
                          </div>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {o.lastClientText || o.reason}
                          </p>
                          {o.avitoItemTitle && (
                            <p style={{ fontSize: 11, color: "var(--accent)", margin: "4px 0 0" }}>
                              🏠 {o.avitoItemTitle}{o.avitoPrice ? ` · ${o.avitoPrice.toLocaleString("ru-RU")} ₽` : ""}
                              {o.hasActiveDeal ? " · заказ есть" : " · можно создать заказ"}
                            </p>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: o.score >= 60 ? "var(--danger)" : "var(--warning)" }}>
                            {o.score}%
                          </div>
                          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{formatWhen(o.lastMessageAt)}</div>
                        </div>
                      </div>

                      {expanded && (
                        <div style={{ marginTop: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                          <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>💡 {o.reason}</p>
                          <textarea
                            className="crm-input"
                            value={text}
                            onChange={(e) => setChatEdits((prev) => ({ ...prev, [o.conversationId]: e.target.value }))}
                            rows={4}
                            style={{ resize: "vertical", fontSize: 13, marginBottom: 10 }}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              className="crm-btn crm-btn-sm"
                              disabled={!text.trim() || sendChatMutation.isPending}
                              onClick={() => sendChatMutation.mutate({ convId: o.conversationId, text: text.trim() })}
                            >
                              ✅ Отправить SMS
                            </button>
                            <button
                              type="button"
                              className="crm-btn crm-btn-ghost crm-btn-sm"
                              onClick={() => openChatWithDraft(setLocation, o.conversationId, text)}
                            >
                              💬 В чат с текстом
                            </button>
                            {!o.hasActiveDeal && (
                              <button
                                type="button"
                                className="crm-btn crm-btn-ghost crm-btn-sm"
                                onClick={() => setLocation(`/?conv=${o.conversationId}`)}
                              >
                                📦 Создать заказ
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}

        {view === "tasks" && (
          <>
            <div className="filter-row" style={{ marginBottom: 12 }}>
              <button type="button" className={`chip${!stageFilter ? " active" : ""}`} onClick={() => setStageFilter("")}>Все</button>
              {Object.entries(STAGE_LABELS).filter(([k]) => k !== "inbox").map(([id, label]) => (
                <button key={id} type="button" className={`chip${stageFilter === id ? " active" : ""}`} onClick={() => setStageFilter(id)}>
                  {label}
                </button>
              ))}
            </div>
            {tasks.length === 0 ? (
              <div className="crm-card" style={{ padding: 24, textAlign: "center", color: "var(--text-muted)" }}>
                Нет задач по заказам, ремонту и доставке.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {tasks.map((p) => (
                  <div key={p.id} className="crm-card" style={{ padding: 14, borderRadius: 12 }}>
                    <div style={{ marginBottom: 8 }}>
                      <span className="chip" style={{ fontSize: 10, marginRight: 6 }}>{STAGE_LABELS[p.stage] || p.stage}</span>
                      <strong>{p.title}</strong>
                      {p.clientName && <span style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: 8 }}>👤 {p.clientName}</span>}
                    </div>
                    {p.reason && <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>{p.reason}</p>}
                    <textarea
                      className="crm-input"
                      value={taskEdits[p.id] ?? p.editedText ?? p.proposedText ?? p.text}
                      onChange={(e) => setTaskEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      rows={3}
                      style={{ resize: "vertical", fontSize: 13, marginBottom: 10 }}
                    />
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button type="button" className="crm-btn crm-btn-sm" disabled={approveMutation.isPending} onClick={() => approveMutation.mutate(p.id)}>
                        ✅ Отправить
                      </button>
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => rejectMutation.mutate(p.id)}>✕</button>
                      {p.conversationId && (
                        <button
                          type="button"
                          className="crm-btn crm-btn-ghost crm-btn-sm"
                          onClick={() => openChatWithDraft(setLocation, p.conversationId!, taskEdits[p.id] ?? p.editedText ?? p.proposedText)}
                        >
                          💬 В чат
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
