import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../lib/fetch-api";
import { useAuth } from "../lib/auth";
import { Avatar } from "./Avatar";
import { TagBadge } from "./TagBadge";
import {
  formatTime,
  channelLabel,
  dealStatusLabel,
  dealStatusColor,
  formatFullTime,
  orderTypeLabel,
} from "../lib/utils";
import { useLocation } from "wouter";
import { CallButton } from "./CallButton";
import { EditableFieldRow } from "./EditableFieldRow";
type Props = {
  clientId: number | null;
  onClose?: () => void;
  open?: boolean;
  onOpenConversation?: (conversationId: number) => void;
};
export function ClientPanel({
  clientId,
  onClose,
  open = true,
  onOpenConversation,
}: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const openConversation = (convId: number) => {
    if (onOpenConversation) onOpenConversation(convId);
    else setLocation(`/?conv=${convId}`);
  };
  const [comment, setComment] = useState("");
  const [editField, setEditField] = useState<null | "name" | "phone" | "email">(
    null,
  );
  const [editVal, setEditVal] = useState("");
  const [newDeal, setNewDeal] = useState(false);
  const [dealTitle, setDealTitle] = useState("");
  const [dealAmount, setDealAmount] = useState("");
  const [activeTab, setActiveTab] = useState<
    "info" | "auto" | "comments" | "deals" | "history"
  >("info");
  const [newVin, setNewVin] = useState("");
  const [newMake, setNewMake] = useState("");
  const [newModel, setNewModel] = useState("");
  const [newPlate, setNewPlate] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["client", clientId],
    queryFn: async () => {
      if (!clientId) return null;
      return apiFetch(`/api/clients/${clientId}`);
    },
    enabled: !!clientId,
  });
  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch("/api/tags"),
  });
  const updateMutation = useMutation({
    mutationFn: (body: any) =>
      apiFetch(`/api/clients/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      setEditField(null);
    },
  });
  const addTagMutation = useMutation({
    mutationFn: (tagId: number) =>
      apiFetch(`/api/clients/${clientId}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tagId }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client", clientId] }),
  });
  const removeTagMutation = useMutation({
    mutationFn: (tagId: number) =>
      apiFetchVoid(`/api/clients/${clientId}/tags/${tagId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client", clientId] }),
  });
  const commentMutation = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/api/clients/${clientId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, userId: user?.id }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      setComment("");
    },
  });
  const dealMutation = useMutation({
    mutationFn: async () => {
      const title = dealTitle.trim();
      if (!title)
        throw new Error("Введите название заказа");
      return apiFetch(`/api/clients/${clientId}/deals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          amount: dealAmount ? parseFloat(dealAmount) : null,
          status: "new",
          orderType: "parts",
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      qc.invalidateQueries({ queryKey: ["deals-all"] });
      setNewDeal(false);
      setDealTitle("");
      setDealAmount("");
    },
  });
  const addVehicleMutation = useMutation({
    mutationFn: () =>
      apiFetch("/api/vehicles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          vin: newVin,
          make: newMake,
          model: newModel,
          plate: newPlate,
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["client", clientId] });
      setNewVin("");
      setNewMake("");
      setNewModel("");
      setNewPlate("");
    },
  });
  const dealUpdateMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      return apiFetch(`/api/deals/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client", clientId] }),
  });
  if (!clientId || !open) {
    return (
      <div className={`client-drawer${open && clientId ? "" : " closed"}`} />
    );
  }
  const client = data?.client;
  const allTags: any[] = tagsData?.tags || [];
  const clientTagIds = new Set((client?.tags || []).map((t: any) => t.id));
  return (
    <div className="client-drawer">
      {" "}
      <div className="client-drawer__head">
        {" "}
        {isLoading ? (
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              background: "var(--border)",
            }}
          />
        ) : (
          <Avatar
            name={client?.name || "?"}
            size={44}
            url={client?.avatarUrl}
          />
        )}{" "}
        <div style={{ flex: 1, minWidth: 0 }}>
          {" "}
          <p
            style={{
              fontWeight: 600,
              fontSize: 15,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {client?.name || "..."}
          </p>{" "}
          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
            {" "}
            {client?.source ? channelLabel(client.source) : ""} ·{" "}
            {formatTime(client?.createdAt)}{" "}
          </p>{" "}
        </div>{" "}
        {onClose && (
          <button
            type="button"
            className="crm-btn crm-btn-ghost crm-btn-icon"
            onClick={onClose}
            title="Закрыть"
          >
            ✕
          </button>
        )}{" "}
      </div>{" "}
      <div className="client-tabs">
        {" "}
        {(["info", "auto", "comments", "deals", "history"] as const).map(
          (tab) => (
            <button
              key={tab}
              type="button"
              className={`client-tab${activeTab === tab ? " active" : ""}`}
              onClick={() => setActiveTab(tab)}
            >
              {" "}
              {
                {
                  info: "Инфо",
                  auto: "Авто",
                  comments: "Заметки",
                  deals: "Заказы",
                  history: "История",
                }[tab]
              }{" "}
            </button>
          ),
        )}{" "}
      </div>{" "}
      <div className="client-body">
        {" "}
        {isLoading ? (
          <div
            style={{
              color: "var(--text-muted)",
              textAlign: "center",
              paddingTop: 40,
            }}
          >
            Загрузка...
          </div>
        ) : activeTab === "info" ? (
          <>
            {" "}
            <p
              style={{
                fontSize: 10,
                color: "var(--text-muted)",
                marginBottom: 12,
                padding: "6px 10px",
                background: "var(--input-bg)",
                borderRadius: 8,
              }}
            >
              {" "}
              Данные подтягиваются из диалога
              автоматически{" "}
            </p>{" "}
            <EditableFieldRow
              label="Имя"
              value={client?.name}
              editing={editField === "name"}
              editVal={editVal}
              onEditStart={() => {
                setEditField("name");
                setEditVal(client?.name || "");
              }}
              onEditChange={setEditVal}
              onEditSave={() => updateMutation.mutate({ name: editVal })}
              onEditCancel={() => setEditField(null)}
            />{" "}
            <EditableFieldRow
              label="Телефон"
              value={client?.phone}
              editing={editField === "phone"}
              editVal={editVal}
              onEditStart={() => {
                setEditField("phone");
                setEditVal(client?.phone || "");
              }}
              onEditChange={setEditVal}
              onEditSave={() => updateMutation.mutate({ phone: editVal })}
              onEditCancel={() => setEditField(null)}
            />{" "}
            {client?.phone && (
              <div style={{ marginBottom: 12 }}>
                {" "}
                <CallButton phone={client.phone} clientId={clientId} />{" "}
              </div>
            )}{" "}
            <div style={{ marginBottom: 10 }}>
              {" "}
              <label
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 2,
                }}
              >
                VIN
              </label>{" "}
              <span
                style={{
                  fontSize: 13,
                  fontFamily: "monospace",
                  color: client?.vehicles?.[0]?.vin
                    ? "var(--accent)"
                    : "var(--text-muted)",
                }}
              >
                {" "}
                {client?.vehicles?.find((v: any) => v.vin)?.vin || "—"}{" "}
              </span>{" "}
            </div>{" "}
            <div style={{ marginBottom: 10 }}>
              {" "}
              <label
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 2,
                }}
              >
                Товар / объявление
              </label>{" "}
              <span
                style={{
                  fontSize: 13,
                  color: client?.productInterest
                    ? "var(--text)"
                    : "var(--text-muted)",
                }}
              >
                {" "}
                {client?.productInterest || "—"}{" "}
              </span>{" "}
            </div>{" "}
            <EditableFieldRow
              label="Email"
              value={client?.email}
              editing={editField === "email"}
              editVal={editVal}
              onEditStart={() => {
                setEditField("email");
                setEditVal(client?.email || "");
              }}
              onEditChange={setEditVal}
              onEditSave={() => updateMutation.mutate({ email: editVal })}
              onEditCancel={() => setEditField(null)}
            />{" "}
            {/* Tags */}{" "}
            <div style={{ marginTop: 16 }}>
              {" "}
              <label
                style={{
                  fontSize: 11,
                  color: "var(--text-muted)",
                  display: "block",
                  marginBottom: 6,
                }}
              >
                Метки
              </label>{" "}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 6,
                  marginBottom: 8,
                }}
              >
                {" "}
                {(client?.tags || []).map((tag: any) => (
                  <TagBadge
                    key={tag.id}
                    name={tag.name}
                    color={tag.color}
                    onRemove={() => removeTagMutation.mutate(tag.id)}
                  />
                ))}{" "}
                {client?.tags?.length === 0 && (
                  <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    Нет меток
                  </span>
                )}{" "}
              </div>{" "}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {" "}
                {allTags
                  .filter((t: any) => !clientTagIds.has(t.id))
                  .map((tag: any) => (
                    <button
                      key={tag.id}
                      onClick={() => addTagMutation.mutate(tag.id)}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        border: `1px solid ${tag.color}44`,
                        background: "transparent",
                        color: tag.color,
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      + {tag.name}
                    </button>
                  ))}{" "}
              </div>{" "}
            </div>{" "}
          </>
        ) : activeTab === "auto" ? (
          <>
            {" "}
            <p
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 10,
              }}
            >
              Автомобили клиента (VIN подбирается
              автоматически из чата)
            </p>{" "}
            {(client?.vehicles || []).map((v: any) => (
              <div
                key={v.id}
                style={{
                  background: "var(--card)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  border: "1px solid var(--border)",
                }}
              >
                {" "}
                <p style={{ fontWeight: 600, fontSize: 13 }}>
                  {[v.make, v.model, v.year].filter(Boolean).join(" ") ||
                    "Автомобиль"}
                </p>{" "}
                {v.vin && (
                  <p
                    style={{
                      fontSize: 11,
                      fontFamily: "monospace",
                      color: "var(--accent)",
                      marginTop: 4,
                    }}
                  >
                    VIN: {v.vin}
                  </p>
                )}{" "}
                {v.plate && (
                  <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    Госномер: {v.plate}
                  </p>
                )}{" "}
              </div>
            ))}{" "}
            <div
              style={{
                background: "var(--card)",
                borderRadius: 8,
                padding: 10,
                border: "1px solid var(--border)",
              }}
            >
              {" "}
              <input
                className="crm-input"
                placeholder="VIN"
                value={newVin}
                onChange={(e) => setNewVin(e.target.value.toUpperCase())}
                style={{ marginBottom: 6, fontFamily: "monospace" }}
              />{" "}
              <div style={{ display: "flex", gap: 6, marginBottom: 6 }}>
                {" "}
                <input
                  className="crm-input"
                  placeholder="Марка"
                  value={newMake}
                  onChange={(e) => setNewMake(e.target.value)}
                />{" "}
                <input
                  className="crm-input"
                  placeholder="Модель"
                  value={newModel}
                  onChange={(e) => setNewModel(e.target.value)}
                />{" "}
              </div>{" "}
              <input
                className="crm-input"
                placeholder="Госномер"
                value={newPlate}
                onChange={(e) => setNewPlate(e.target.value)}
                style={{ marginBottom: 8 }}
              />{" "}
              <button
                type="button"
                className="crm-btn"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() =>
                  (newVin || newMake) && addVehicleMutation.mutate()
                }
              >
                + Добавить авто
              </button>{" "}
            </div>{" "}
          </>
        ) : activeTab === "comments" ? (
          <>
            {" "}
            <div style={{ marginBottom: 12 }}>
              {" "}
              <textarea
                className="crm-input"
                placeholder="Добавить заметку о клиенте..."
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ height: 72, resize: "none", marginBottom: 6 }}
              />{" "}
              <button
                className="crm-btn"
                onClick={() =>
                  comment.trim() && commentMutation.mutate(comment.trim())
                }
                disabled={!comment.trim() || commentMutation.isPending}
                style={{ width: "100%", justifyContent: "center" }}
              >
                Сохранить заметку
              </button>{" "}
            </div>{" "}
            {(client?.comments || []).map((c: any) => (
              <div
                key={c.id}
                style={{
                  background: "var(--card)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  border: "1px solid var(--border)",
                }}
              >
                {" "}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  {" "}
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "var(--accent)",
                    }}
                  >
                    {c.user?.name || "Неизвестно"}
                  </span>{" "}
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {formatFullTime(c.createdAt)}
                  </span>{" "}
                </div>{" "}
                <p style={{ fontSize: 12, lineHeight: 1.5 }}>{c.text}</p>{" "}
              </div>
            ))}{" "}
            {(client?.comments?.length || 0) === 0 && (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                Нет заметок
              </p>
            )}{" "}
          </>
        ) : activeTab === "deals" ? (
          <>
            {" "}
            <button
              className="crm-btn"
              onClick={() => setNewDeal(!newDeal)}
              style={{
                width: "100%",
                justifyContent: "center",
                marginBottom: 12,
              }}
            >
              + Новый заказ
            </button>{" "}
            {newDeal && (
              <div
                style={{
                  background: "var(--card)",
                  borderRadius: 8,
                  padding: 12,
                  marginBottom: 12,
                  border: "1px solid var(--border)",
                }}
              >
                {" "}
                <input
                  className="crm-input"
                  placeholder="Название сделки"
                  value={dealTitle}
                  onChange={(e) => setDealTitle(e.target.value)}
                  style={{ marginBottom: 8 }}
                />{" "}
                <input
                  className="crm-input"
                  placeholder="Сумма (₽)"
                  type="number"
                  value={dealAmount}
                  onChange={(e) => setDealAmount(e.target.value)}
                  style={{ marginBottom: 8 }}
                />{" "}
                <button
                  className="crm-btn"
                  onClick={() => dealTitle && dealMutation.mutate()}
                  style={{ width: "100%", justifyContent: "center" }}
                >
                  Создать
                </button>{" "}
              </div>
            )}{" "}
            {(client?.deals || []).map((d: any) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setLocation(`/deals?deal=${d.id}`)}
                onKeyDown={(e) =>
                  e.key === "Enter" && setLocation(`/deals?deal=${d.id}`)
                }
                style={{
                  background: "var(--card)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                }}
              >
                {" "}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    marginBottom: 4,
                  }}
                >
                  {" "}
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {d.title}
                  </span>{" "}
                  {d.amount && (
                    <span style={{ fontSize: 12, color: "var(--success)" }}>
                      {d.amount.toLocaleString()} ₽
                    </span>
                  )}{" "}
                </div>{" "}
                <p
                  style={{
                    fontSize: 10,
                    color: "var(--text-muted)",
                    marginBottom: 4,
                  }}
                >
                  {" "}
                  {orderTypeLabel(d.orderType)}
                  {d.avitoItemId ? " · 🏠 Авито" : ""}
                  {d.vin ? ` · VIN ${d.vin}` : ""}{" "}
                </p>{" "}
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {" "}
                  {["new", "quoted", "in_progress", "ready", "done"].map(
                    (s) => (
                      <button
                        key={s}
                        onClick={(e) => {
                          e.stopPropagation();
                          dealUpdateMutation.mutate({ id: d.id, status: s });
                        }}
                        style={{
                          padding: "2px 8px",
                          borderRadius: 6,
                          border: "none",
                          background:
                            d.status === s
                              ? dealStatusColor(s)
                              : "var(--border)",
                          color: d.status === s ? "#fff" : "var(--text-muted)",
                          cursor: "pointer",
                          fontSize: 10,
                          fontWeight: 500,
                        }}
                      >
                        {dealStatusLabel(s)}
                      </button>
                    ),
                  )}{" "}
                </div>{" "}
              </div>
            ))}{" "}
            {(client?.deals?.length || 0) === 0 && (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                Нет сделок
              </p>
            )}{" "}
          </>
        ) : activeTab === "history" ? (
          <>
            {" "}
            <p
              style={{
                fontSize: 11,
                color: "var(--text-muted)",
                marginBottom: 10,
              }}
            >
              Все диалоги с клиентом
            </p>{" "}
            {(client?.conversations || []).map((conv: any) => (
              <button
                key={conv.id}
                type="button"
                onClick={() => openConversation(conv.id)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  background: "var(--card)",
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                  border: "1px solid var(--border)",
                  cursor: "pointer",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent)";
                  e.currentTarget.style.background = "var(--accent-soft)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "var(--card)";
                }}
              >
                {" "}
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  {" "}
                  <span style={{ fontSize: 12, fontWeight: 500 }}>
                    {channelLabel(conv.channelType)}
                  </span>{" "}
                  <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                    {formatTime(conv.lastMessageAt || conv.createdAt)}
                  </span>{" "}
                </div>{" "}
                <p
                  style={{
                    fontSize: 11,
                    color: "var(--text-muted)",
                    marginTop: 2,
                  }}
                >
                  {" "}
                  Статус:{" "}
                  {conv.status === "open"
                    ? "Открыт"
                    : conv.status === "pending"
                      ? "В ожидании"
                      : "Закрыт"}{" "}
                </p>{" "}
                <p
                  style={{ fontSize: 10, color: "var(--accent)", marginTop: 4 }}
                >
                  Открыть диалог →
                </p>{" "}
              </button>
            ))}{" "}
            {(client?.conversations?.length || 0) === 0 && (
              <p
                style={{
                  color: "var(--text-muted)",
                  fontSize: 13,
                  textAlign: "center",
                }}
              >
                Нет истории
              </p>
            )}{" "}
          </>
        ) : null}{" "}
      </div>{" "}
    </div>
  );
}
