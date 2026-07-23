import { useState, useCallback, useEffect, type ReactNode, type CSSProperties } from "react";
import { useSettingsSync } from "../lib/use-form-sync";
import { uploadMediaFile } from "../lib/upload";
import { type TemplateMedia, MAX_TEMPLATE_MEDIA, mediaTypeFromFile } from "../lib/template-media";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../lib/fetch-api";
import { useAuth } from "../lib/auth";
import { AppShell } from "../components/AppShell";
import { SalesSettingsSection } from "../components/settings/SalesSettingsSection";
import { TagBadge } from "../components/TagBadge";
import { useToast } from "../lib/toast";
import { TEMPLATE_CATEGORIES, TEMPLATE_VARS, categoryLabel } from "../lib/templates";
import { NotificationSettings } from "../components/NotificationSettings";
import { validatePassword, fetchPasswordPolicy } from "../lib/password";

const THEMES = [
  { id: "dark-navy", label: "Тёмно-синяя", preview: ["#0f1629", "#2563eb"] },
  { id: "midnight", label: "Полночь", preview: ["#0a0a0f", "#7c3aed"] },
  { id: "dark-teal", label: "Тёмный бирюзовый", preview: ["#0d1f1f", "#0d9488"] },
  { id: "light", label: "Светлая", preview: ["#f8fafc", "#2563eb"] },
  { id: "telegram", label: "Telegram", preview: ["#efeff3", "#2aabee"] },
];

const TAG_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#06b6d4","#6b7280","#f59e0b","#a855f7","#10b981"];

function SettingsCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16, ...style }}>{children}</div>
  );
}

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"themes" | "security" | "alerts" | "tags" | "templates" | "users" | "channels" | "general" | "telephony" | "cdek" | "ai" | "sales">("themes");

  const TAB_LABELS: Record<string, string> = {
    themes: "🎨 Темы",
    security: "🔒 Безопасность",
    alerts: "🔔 Оповещения",
    tags: "🏷️ Метки",
    templates: "💬 Шаблоны",
    users: "👥 Операторы",
    channels: "📡 Каналы",
    general: "⚙️ Общее",
    telephony: "📞 Телефония",
    cdek: "📦 СДЭК",
    ai: "✨ Алиса / ИИ",
    sales: "🧾 Реализация",
  };
  const ALL_TABS = ["themes", "security", "alerts", "tags", "templates", "users", "channels", "general", "telephony", "cdek", "ai", "sales"] as const;

  const [pwMinLength, setPwMinLength] = useState(10);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPassword2, setNewPassword2] = useState("");
  const [pwChanging, setPwChanging] = useState(false);

  useEffect(() => {
    fetchPasswordPolicy().then((p) => setPwMinLength(p.minLength));
  }, []);

  // Tags
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");

  // Users
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"operator" | "admin">("operator");
  const [editUserId, setEditUserId] = useState<number | null>(null);
  const [editUserName, setEditUserName] = useState("");
  const [editUserEmail, setEditUserEmail] = useState("");
  const [editUserPassword, setEditUserPassword] = useState("");
  const [editUserRole, setEditUserRole] = useState<"operator" | "admin">("operator");

  // Channels
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState("telegram");
  const [chBotToken, setChBotToken] = useState("");
  const [chClientId, setChClientId] = useState("");
  const [chClientSecret, setChClientSecret] = useState("");
  const [chUserId, setChUserId] = useState("");
  const [chPhoneNumberId, setChPhoneNumberId] = useState("");
  const [chWhatsappToken, setChWhatsappToken] = useState("");
  const [chWhatsappTemplate, setChWhatsappTemplate] = useState("");
  const [chWhatsappTemplateLang, setChWhatsappTemplateLang] = useState("ru");
  const [chVerifyToken, setChVerifyToken] = useState("");
  const [chVkToken, setChVkToken] = useState("");
  const [chWebhookSecret, setChWebhookSecret] = useState("");
  const [chAppSecret, setChAppSecret] = useState("");
  const [channelError, setChannelError] = useState("");
  const [tplTitle, setTplTitle] = useState("");
  const [tplText, setTplText] = useState("");
  const [tplCategory, setTplCategory] = useState("general");
  const [editTplId, setEditTplId] = useState<number | null>(null);
  const [editTplTitle, setEditTplTitle] = useState("");
  const [editTplText, setEditTplText] = useState("");
  const [tplMedia, setTplMedia] = useState<TemplateMedia[]>([]);
  const [editTplMedia, setEditTplMedia] = useState<TemplateMedia[]>([]);

  const templateMediaFromRow = (t: { imageUrl?: string | null; mediaUrls?: TemplateMedia[] }) =>
    t.mediaUrls?.length ? t.mediaUrls : (t.imageUrl ? [{ url: t.imageUrl, type: "photo" as const }] : []);

  const attachTplMedia = async (file: File | undefined, mode: "new" | "edit") => {
    if (!file) return;
    const list = mode === "new" ? tplMedia : editTplMedia;
    if (list.length >= MAX_TEMPLATE_MEDIA) {
      toast(`Максимум ${MAX_TEMPLATE_MEDIA} файла в шаблоне`, "error");
      return;
    }
    try {
      const url = await uploadMediaFile(file);
      const item: TemplateMedia = { url, type: mediaTypeFromFile(file) };
      if (mode === "new") setTplMedia((prev) => [...prev, item]);
      else setEditTplMedia((prev) => [...prev, item]);
      toast("Файл прикреплён", "success");
    } catch (err: any) {
      toast(err.message, "error");
    }
  };
  const [telProvider, setTelProvider] = useState<"none" | "megafon" | "mts">("none");
  const [telEnabled, setTelEnabled] = useState(false);
  const [megafonUrl, setMegafonUrl] = useState("");
  const [megafonToken, setMegafonToken] = useState("");
  const [mtsKey, setMtsKey] = useState("");
  const [mtsAppId, setMtsAppId] = useState("");
  const [mtsRedirect, setMtsRedirect] = useState("");
  const [telWebhookSecret, setTelWebhookSecret] = useState("");
  const [telLoadBalance, setTelLoadBalance] = useState(false);
  const [telLoadBalanceUsers, setTelLoadBalanceUsers] = useState<number[]>([]);
  const [extEdits, setExtEdits] = useState<Record<number, string>>({});
  const [cdekEnabled, setCdekEnabled] = useState(false);
  const [cdekTestMode, setCdekTestMode] = useState(true);
  const [cdekClientId, setCdekClientId] = useState("");
  const [cdekClientSecret, setCdekClientSecret] = useState("");
  const [cdekShipmentPoint, setCdekShipmentPoint] = useState("");
  const [cdekFromCity, setCdekFromCity] = useState("");
  const [cdekTariff, setCdekTariff] = useState("136");
  const [avitoAutoDeals, setAvitoAutoDeals] = useState(false);
  const [avitoAdvanceAlert, setAvitoAdvanceAlert] = useState(true);
  const [avitoAdvanceThreshold, setAvitoAdvanceThreshold] = useState("200");
  const [advanceAlertTelegramChatId, setAdvanceAlertTelegramChatId] = useState("");

  const { data: tagsData } = useQuery({
    queryKey: ["tags"],
    queryFn: () => apiFetch("/api/tags"),
  });

  const { data: usersData } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiFetch("/api/users"),
  });

  const { data: channelsData } = useQuery({
    queryKey: ["channels"],
    queryFn: () => apiFetch("/api/channels"),
  });

  const { data: templatesData } = useQuery({
    queryKey: ["templates"],
    queryFn: () => apiFetch("/api/templates"),
  });

  const { data: aiStatus } = useQuery({
    queryKey: ["ai-status"],
    queryFn: () => apiFetch<{ configured: boolean; model: string; missing?: string[]; hasApiKey?: boolean; hasFolderId?: boolean }>("/api/ai/status"),
    enabled: tab === "ai",
  });

  const { data: telData } = useQuery({
    queryKey: ["telephony-settings"],
    queryFn: () => apiFetch<{ settings: any }>("/api/telephony/settings"),
    enabled: tab === "telephony" && user?.role === "admin",
  });

  const { data: cdekData } = useQuery({
    queryKey: ["cdek-settings"],
    queryFn: () => apiFetch<{ settings: any }>("/api/cdek/settings"),
    enabled: tab === "cdek" && user?.role === "admin",
  });

  const { data: crmData } = useQuery({
    queryKey: ["crm-settings"],
    queryFn: () => apiFetch<{ settings: {
      avitoAutoDeals?: boolean;
      avitoAdvanceAlertEnabled?: boolean;
      avitoAdvanceThresholdRub?: number;
      advanceAlertTelegramChatId?: string | null;
    } }>("/api/crm/settings"),
    enabled: tab === "general",
  });

  const { data: cdekStatus } = useQuery({
    queryKey: ["cdek-status"],
    queryFn: () => apiFetch<{ configured: boolean }>("/api/cdek/status"),
    enabled: tab === "cdek",
  });

  const syncTelSettings = useCallback(() => {
    const s = telData?.settings;
    if (!s) return;
    setTelProvider(s.provider || "none");
    setTelEnabled(!!s.enabled);
    setMegafonUrl(s.megafonApiUrl || "");
    setMtsAppId(s.mtsAppId || "");
    setMtsRedirect(s.mtsRedirectNumber || "");
    setTelWebhookSecret(s.webhookSecret || "");
    setTelLoadBalance(!!s.callLoadBalanceEnabled);
    try {
      const ids = s.callLoadBalanceUserIds ? JSON.parse(s.callLoadBalanceUserIds) : [];
      setTelLoadBalanceUsers(Array.isArray(ids) ? ids : []);
    } catch {
      setTelLoadBalanceUsers([]);
    }
  }, [telData?.settings]);

  const syncCdekSettings = useCallback(() => {
    const s = cdekData?.settings;
    if (!s) return;
    setCdekEnabled(!!s.enabled);
    setCdekTestMode(s.testMode !== false);
    setCdekClientId(s.clientId || "");
    setCdekShipmentPoint(s.shipmentPoint || "");
    setCdekFromCity(s.fromCityCode ? String(s.fromCityCode) : "");
    setCdekTariff(s.defaultTariffCode ? String(s.defaultTariffCode) : "136");
  }, [cdekData?.settings]);

  const syncCrmSettings = useCallback(() => {
    const s = crmData?.settings;
    if (!s) return;
    setAvitoAutoDeals(!!s.avitoAutoDeals);
    setAvitoAdvanceAlert(s.avitoAdvanceAlertEnabled !== false);
    setAvitoAdvanceThreshold(String(s.avitoAdvanceThresholdRub ?? 200));
    setAdvanceAlertTelegramChatId(s.advanceAlertTelegramChatId || "");
  }, [crmData?.settings]);

  useSettingsSync("telephony", tab, !!telData?.settings, syncTelSettings);
  useSettingsSync("cdek", tab, !!cdekData?.settings, syncCdekSettings);
  useSettingsSync("general", tab, !!crmData?.settings, syncCrmSettings);

  const saveCrmMutation = useMutation({
    mutationFn: (payload: {
      avitoAutoDeals?: boolean;
      avitoAdvanceAlertEnabled?: boolean;
      avitoAdvanceThresholdRub?: number;
      advanceAlertTelegramChatId?: string | null;
    }) => apiFetch("/api/crm/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-settings"] });
      toast("Настройки сохранены", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const { data: avitoCpaStatus } = useQuery({
    queryKey: ["avito-cpa-status"],
    queryFn: () => apiFetch<{
      configured: boolean;
      threshold?: number;
      level: string;
      checkedAt?: string;
      accounts?: {
        channelId: number;
        channelName: string;
        advance: number | null;
        cpaBalance: number | null;
        wallet: number | null;
        debt: number | null;
        level: string;
        checkedAt?: string;
        error?: string;
      }[];
    }>("/api/avito/cpa-status"),
    enabled: tab === "general",
    refetchInterval: 60_000,
  });

  const saveCdekMutation = useMutation({
    mutationFn: () => apiFetch("/api/cdek/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled: cdekEnabled,
        testMode: cdekTestMode,
        clientId: cdekClientId,
        clientSecret: cdekClientSecret || undefined,
        shipmentPoint: cdekShipmentPoint,
        fromCityCode: cdekFromCity ? Number(cdekFromCity) : null,
        defaultTariffCode: cdekTariff ? Number(cdekTariff) : 136,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["cdek-settings"] });
      qc.invalidateQueries({ queryKey: ["cdek-status"] });
      toast("Настройки СДЭК сохранены", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const saveTelMutation = useMutation({
    mutationFn: () => apiFetch("/api/telephony/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: telProvider,
        enabled: telEnabled,
        megafonApiUrl: megafonUrl,
        megafonToken: megafonToken || undefined,
        mtsApiKey: mtsKey || undefined,
        mtsAppId: mtsAppId,
        mtsRedirectNumber: mtsRedirect,
        webhookSecret: telWebhookSecret,
        callLoadBalanceEnabled: telLoadBalance,
        callLoadBalanceUserIds: telLoadBalanceUsers,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telephony-settings"] });
      qc.invalidateQueries({ queryKey: ["telephony-status"] });
      toast("Настройки телефонии сохранены", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const saveExtMutation = useMutation({
    mutationFn: ({ id, phoneExtension }: { id: number; phoneExtension: string }) =>
      apiFetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneExtension: phoneExtension || null }),
      }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); toast("Добавочный сохранён", "success"); },
  });

  const createTplMutation = useMutation({
    mutationFn: () => apiFetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: tplTitle.trim(),
        text: tplText.trim(),
        category: tplCategory,
        sortOrder: 0,
        mediaUrls: tplMedia,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setTplTitle(""); setTplText(""); setTplMedia([]);
      toast("Шаблон добавлен", "success");
    },
    onError: (e: Error) => toast(e.message || "Не удалось добавить шаблон", "error"),
  });

  const updateTplMutation = useMutation({
    mutationFn: ({ id, title, text, category, mediaUrls }: { id: number; title: string; text: string; category?: string; mediaUrls?: TemplateMedia[] }) =>
      apiFetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text, category, mediaUrls: mediaUrls || [] }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setEditTplId(null);
      toast("Шаблон обновлён", "success");
    },
    onError: (e: Error) => toast(e.message || "Не удалось обновить шаблон", "error"),
  });

  const deleteTplMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); toast("Шаблон удалён", "info"); },
  });

  const createTagMutation = useMutation({
    mutationFn: () => apiFetch("/api/tags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newTagName, color: newTagColor }),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tags"] }); setNewTagName(""); },
  });

  const deleteTagMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/tags/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tags"] }),
  });

  const createUserMutation = useMutation({
    mutationFn: () => apiFetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newUserName, email: newUserEmail, password: newUserPassword, role: newUserRole }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setNewUserName(""); setNewUserEmail(""); setNewUserPassword("");
      toast("Оператор добавлен", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const updateUserMutation = useMutation({
    mutationFn: (payload: { id: number; name: string; email: string; role: string; password?: string }) => {
      const body: Record<string, string> = {
        name: payload.name.trim(),
        email: payload.email.trim(),
        role: payload.role,
      };
      if (payload.password?.trim()) body.password = payload.password.trim();
      return apiFetch(`/api/users/${payload.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      setEditUserId(null);
      setEditUserPassword("");
      toast("Данные оператора сохранены", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const deleteUserMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      toast("Оператор удалён", "info");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const startEditUser = (u: { id: number; name: string; email: string; role: string }) => {
    setEditUserId(u.id);
    setEditUserName(u.name);
    setEditUserEmail(u.email);
    setEditUserRole(u.role as "operator" | "admin");
    setEditUserPassword("");
  };

  const createChannelMutation = useMutation({
    mutationFn: async () => {
      setChannelError("");
      return apiFetch("/api/channels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: newChannelName,
          type: newChannelType,
          botToken: chBotToken || undefined,
          clientId: chClientId || undefined,
          clientSecret: chClientSecret || undefined,
          userId: chUserId || undefined,
          phoneNumberId: chPhoneNumberId || undefined,
          whatsappToken: chWhatsappToken || undefined,
          whatsappTemplateName: chWhatsappTemplate || undefined,
          whatsappTemplateLang: chWhatsappTemplateLang || undefined,
          verifyToken: chVerifyToken || undefined,
          vkToken: chVkToken || undefined,
          webhookSecret: chWebhookSecret || undefined,
          appSecret: chAppSecret || undefined,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      setNewChannelName("");
      setChBotToken(""); setChClientId(""); setChClientSecret(""); setChUserId("");
      setChPhoneNumberId(""); setChWhatsappToken(""); setChWhatsappTemplate(""); setChWhatsappTemplateLang("ru");
      setChVerifyToken(""); setChVkToken(""); setChWebhookSecret(""); setChAppSecret("");
    },
    onError: (e: Error) => setChannelError(e.message),
  });

  const testChannelMutation = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/channels/${id}/test`, { method: "POST" }),
  });

  const deleteChannelMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/channels/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["channels"] }),
  });

  const applyTheme = async (themeId: string) => {
    document.documentElement.setAttribute("data-theme", themeId === "dark-navy" ? "" : themeId);
    setUser({ ...user!, theme: themeId });
    await apiFetch("/api/auth/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: themeId }),
    });
  };

  const tags: any[] = tagsData?.tags || [];
  const users: any[] = usersData?.users || [];
  const channels: any[] = channelsData?.channels || [];
  const templates: any[] = templatesData?.templates || [];

  return (
    <AppShell hideTopBar>
      <div className="settings-layout" style={{ display: "flex", overflow: "hidden", flex: 1 }}>
        <div className="settings-layout__nav" style={{ width: 200, borderRight: "1px solid var(--border)", padding: 16, flexShrink: 0 }}>
          <h2 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Настройки</h2>
          {ALL_TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                width: "100%", textAlign: "left", padding: "8px 12px", borderRadius: 8,
                border: "none",
                background: tab === t ? "var(--accent)22" : "transparent",
                color: tab === t ? "var(--accent)" : "var(--text-muted)",
                cursor: "pointer", fontSize: 13, fontWeight: 500, marginBottom: 4,
              }}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="settings-layout__content" style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "alerts" && <NotificationSettings />}
          {tab === "security" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Безопасность</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16 }}>
                Смена пароля завершает все сессии на других устройствах.
              </p>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Сменить пароль</p>
                <div style={{ display: "grid", gap: 10, maxWidth: 400 }}>
                  <input className="crm-input" type="password" placeholder="Текущий пароль" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" />
                  <input className="crm-input" type="password" placeholder={`Новый пароль (${pwMinLength}+ символов, буква и цифра)`} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" />
                  <input className="crm-input" type="password" placeholder="Повторите новый пароль" value={newPassword2} onChange={(e) => setNewPassword2(e.target.value)} autoComplete="new-password" />
                  <button
                    type="button"
                    className="crm-btn"
                    disabled={pwChanging}
                    style={{ width: "fit-content" }}
                    onClick={async () => {
                      if (newPassword !== newPassword2) {
                        toast("Пароли не совпадают", "error");
                        return;
                      }
                      const err = validatePassword(newPassword, user?.email, pwMinLength);
                      if (err) {
                        toast(err, "error");
                        return;
                      }
                      setPwChanging(true);
                      try {
                        await apiFetch("/api/auth/change-password", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ currentPassword, newPassword }),
                        });
                        setCurrentPassword("");
                        setNewPassword("");
                        setNewPassword2("");
                        toast("Пароль изменён", "info");
                      } catch (e: any) {
                        toast(e.message || "Ошибка", "error");
                      } finally {
                        setPwChanging(false);
                      }
                    }}
                  >
                    {pwChanging ? "Сохранение..." : "Сохранить пароль"}
                  </button>
                </div>
              </SettingsCard>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Сессии</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="crm-btn crm-btn-ghost"
                    onClick={async () => {
                      try {
                        await apiFetch("/api/auth/logout-others", { method: "POST" });
                        toast("Другие устройства отключены", "info");
                      } catch (e: any) {
                        toast(e.message, "error");
                      }
                    }}
                  >
                    Выйти на других устройствах
                  </button>
                  <button
                    type="button"
                    className="crm-btn crm-btn-ghost"
                    style={{ color: "var(--danger)" }}
                    onClick={async () => {
                      try {
                        await apiFetch("/api/auth/logout-all", { method: "POST" });
                        window.location.href = "/login";
                      } catch (e: any) {
                        toast(e.message, "error");
                      }
                    }}
                  >
                    Выйти везде
                  </button>
                </div>
              </SettingsCard>
            </>
          )}
          {tab === "themes" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Тема интерфейса</h3>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                {THEMES.map(theme => (
                  <button
                    key={theme.id}
                    onClick={() => applyTheme(theme.id)}
                    style={{
                      border: (user?.theme || "dark-navy") === theme.id ? "2px solid var(--accent)" : "2px solid var(--border)",
                      borderRadius: 12,
                      padding: 12,
                      cursor: "pointer",
                      background: "var(--card)",
                      textAlign: "center",
                      minWidth: 120,
                    }}
                  >
                    <div style={{ display: "flex", gap: 4, justifyContent: "center", marginBottom: 8 }}>
                      {theme.preview.map((c, i) => (
                        <div key={i} style={{ width: 28, height: 28, borderRadius: 8, background: c, border: "1px solid rgba(255,255,255,0.1)" }} />
                      ))}
                    </div>
                    <p style={{ fontSize: 12, fontWeight: 500, color: "var(--text)" }}>{theme.label}</p>
                    {(user?.theme || "dark-navy") === theme.id && (
                      <p style={{ fontSize: 10, color: "var(--accent)", marginTop: 4 }}>✓ Активна</p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === "templates" && (
            <>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Шаблоны ответов для операторов</h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                Переменные в тексте: {TEMPLATE_VARS.map((v) => v.key).join(", ")} — подставляются автоматически из карточки клиента
              </p>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Новый шаблон</p>
                <input className="crm-input" placeholder="Название (кнопка)" value={tplTitle} onChange={e => setTplTitle(e.target.value)} style={{ marginBottom: 8 }} />
                <textarea className="crm-input" placeholder="Здравствуйте, {имя}! По VIN {vin}..." value={tplText} onChange={e => setTplText(e.target.value)} style={{ height: 80, resize: "none", marginBottom: 8 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <label className="crm-btn crm-btn-ghost crm-btn-sm" style={{ cursor: "pointer" }}>
                    📎 Фото/видео ({tplMedia.length}/{MAX_TEMPLATE_MEDIA})
                    <input type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => { attachTplMedia(e.target.files?.[0], "new"); e.target.value = ""; }} />
                  </label>
                  {tplMedia.map((m, i) => (
                    <div key={m.url} style={{ position: "relative" }}>
                      {m.type === "video" ? (
                        <video src={m.url} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />
                      ) : (
                        <img src={m.url} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />
                      )}
                      <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" style={{ position: "absolute", top: -6, right: -6, padding: "0 4px", minHeight: 20 }} onClick={() => setTplMedia((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
                    </div>
                  ))}
                </div>
                <select className="crm-input" value={tplCategory} onChange={e => setTplCategory(e.target.value)} style={{ marginBottom: 10, maxWidth: 200 }}>
                  {TEMPLATE_CATEGORIES.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button
                  type="button"
                  className="crm-btn"
                  disabled={!tplTitle.trim() || !tplText.trim() || createTplMutation.isPending}
                  onClick={() => createTplMutation.mutate()}
                >
                  {createTplMutation.isPending ? "Сохранение…" : "Добавить шаблон"}
                </button>
              </SettingsCard>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {templates.map((t: any) => (
                  <div key={t.id} className="crm-card" style={{ padding: 14, borderRadius: 10 }}>
                    {editTplId === t.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <input className="crm-input" value={editTplTitle} onChange={e => setEditTplTitle(e.target.value)} />
                        <textarea className="crm-input" value={editTplText} onChange={e => setEditTplText(e.target.value)} rows={3} style={{ resize: "none" }} />
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <label className="crm-btn crm-btn-ghost crm-btn-sm" style={{ cursor: "pointer" }}>
                            📎 Фото/видео ({editTplMedia.length}/{MAX_TEMPLATE_MEDIA})
                            <input type="file" accept="image/*,video/*" style={{ display: "none" }} onChange={(e) => { attachTplMedia(e.target.files?.[0], "edit"); e.target.value = ""; }} />
                          </label>
                          {editTplMedia.map((m, i) => (
                            <div key={m.url} style={{ position: "relative" }}>
                              {m.type === "video" ? (
                                <video src={m.url} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                              ) : (
                                <img src={m.url} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                              )}
                              <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" style={{ position: "absolute", top: -6, right: -6, padding: "0 4px", minHeight: 20 }} onClick={() => setEditTplMedia((prev) => prev.filter((_, idx) => idx !== i))}>✕</button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" className="crm-btn crm-btn-sm" onClick={() => updateTplMutation.mutate({ id: t.id, title: editTplTitle, text: editTplText, mediaUrls: editTplMedia })}>Сохранить</button>
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setEditTplId(null)}>Отмена</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <strong style={{ fontSize: 13 }}>{t.title}</strong>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" onClick={() => { setEditTplId(t.id); setEditTplTitle(t.title); setEditTplText(t.text); setEditTplMedia(templateMediaFromRow(t)); }} style={{ background: "none", border: "none", cursor: "pointer" }}>✏️</button>
                            <button type="button" onClick={() => deleteTplMutation.mutate(t.id)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>🗑</button>
                          </div>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.text}</p>
                        {templateMediaFromRow(t).length > 0 && (
                          <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                            {templateMediaFromRow(t).map((m) =>
                              m.type === "video" ? (
                                <video key={m.url} src={m.url} style={{ maxWidth: 80, maxHeight: 56, borderRadius: 6, objectFit: "cover" }} />
                              ) : (
                                <img key={m.url} src={m.url} alt="" style={{ maxWidth: 80, maxHeight: 56, borderRadius: 6, objectFit: "cover" }} />
                              ),
                            )}
                          </div>
                        )}
                        <span className="chip" style={{ marginTop: 8, display: "inline-block" }}>{categoryLabel(t.category)}</span>
                      </>
                    )}
                  </div>
                ))}
                {templates.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Нет шаблонов — добавьте типовые ответы для операторов</p>}
              </div>
            </>
          )}

          {tab === "tags" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Управление метками</h3>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Создать метку</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  <input className="crm-input" placeholder="Название метки" value={newTagName} onChange={e => setNewTagName(e.target.value)} style={{ width: 200 }} />
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {TAG_COLORS.map(c => (
                      <button
                        key={c}
                        onClick={() => setNewTagColor(c)}
                        style={{
                          width: 24, height: 24, borderRadius: "50%", background: c, border: newTagColor === c ? "3px solid var(--text)" : "2px solid transparent",
                          cursor: "pointer",
                        }}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="crm-btn"
                    disabled={!newTagName.trim() || createTagMutation.isPending}
                    onClick={() => createTagMutation.mutate()}
                    style={{ height: 36 }}
                  >
                    + Добавить
                  </button>
                </div>
              </SettingsCard>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {tags.map((tag: any) => (
                  <div key={tag.id} style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}>
                    <TagBadge name={tag.name} color={tag.color} />
                    {user?.role === "admin" && (
                      <button
                        onClick={() => deleteTagMutation.mutate(tag.id)}
                        style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 14 }}
                      >×</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "users" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>Операторы</h3>
              {user?.role === "admin" && (
                <SettingsCard>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Добавить оператора</p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <input className="crm-input" placeholder="Имя" value={newUserName} onChange={e => setNewUserName(e.target.value)} style={{ width: 160 }} />
                    <input className="crm-input" placeholder="Email" type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} style={{ width: 200 }} />
                    <input className="crm-input" placeholder="Пароль" type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} style={{ width: 140 }} />
                    <select className="crm-input" value={newUserRole} onChange={e => setNewUserRole(e.target.value as any)} style={{ width: 120 }}>
                      <option value="operator">Оператор</option>
                      <option value="admin">Администратор</option>
                    </select>
                    <button
                      type="button"
                      className="crm-btn"
                      disabled={!newUserName.trim() || !newUserEmail.trim() || !newUserPassword || createUserMutation.isPending}
                      onClick={() => createUserMutation.mutate()}
                      style={{ height: 36 }}
                    >
                      + Добавить
                    </button>
                  </div>
                </SettingsCard>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {users.filter((u: any) => u.isActive !== false).map((u: any) => (
                  <div key={u.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}>
                    {editUserId === u.id ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        <p style={{ fontSize: 13, fontWeight: 600 }}>Редактирование: {u.name}</p>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input className="crm-input" placeholder="Имя" value={editUserName} onChange={(e) => setEditUserName(e.target.value)} style={{ width: 160 }} />
                          <input className="crm-input" placeholder="Email" type="email" value={editUserEmail} onChange={(e) => setEditUserEmail(e.target.value)} style={{ width: 200 }} />
                          <input className="crm-input" placeholder="Новый пароль (необязательно)" type="password" value={editUserPassword} onChange={(e) => setEditUserPassword(e.target.value)} style={{ width: 180 }} />
                          <select className="crm-input" value={editUserRole} onChange={(e) => setEditUserRole(e.target.value as "operator" | "admin")} style={{ width: 140 }}>
                            <option value="operator">Оператор</option>
                            <option value="admin">Администратор</option>
                          </select>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button
                            type="button"
                            className="crm-btn crm-btn-sm"
                            disabled={!editUserName.trim() || !editUserEmail.trim() || updateUserMutation.isPending}
                            onClick={() => updateUserMutation.mutate({
                              id: u.id,
                              name: editUserName,
                              email: editUserEmail,
                              role: editUserRole,
                              password: editUserPassword || undefined,
                            })}
                          >
                            {updateUserMutation.isPending ? "..." : "Сохранить"}
                          </button>
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setEditUserId(null)}>Отмена</button>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--accent)33", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                          {u.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div style={{ flex: 1, minWidth: 140 }}>
                          <p style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</p>
                          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email}</p>
                        </div>
                        <span style={{
                          padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                          background: u.role === "admin" ? "var(--warning)22" : "var(--accent)22",
                          color: u.role === "admin" ? "var(--warning)" : "var(--accent)",
                        }}>{u.role === "admin" ? "Администратор" : "Оператор"}</span>
                        <input
                          className="crm-input"
                          placeholder="Добавочный ВАТС"
                          value={extEdits[u.id] ?? u.phoneExtension ?? ""}
                          onChange={(e) => setExtEdits({ ...extEdits, [u.id]: e.target.value })}
                          style={{ width: 110, fontSize: 11 }}
                          title="Внутренний номер в Мегафон ВАТС или мобильный для МТС"
                          disabled={user?.role !== "admin"}
                        />
                        {user?.role === "admin" && (
                          <button
                            type="button"
                            onClick={() => saveExtMutation.mutate({ id: u.id, phoneExtension: extEdits[u.id] ?? u.phoneExtension ?? "" })}
                            style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "var(--text-muted)" }}
                            title="Сохранить добавочный"
                          >💾</button>
                        )}
                        {user?.role === "admin" && (
                          <button
                            type="button"
                            className="crm-btn crm-btn-ghost crm-btn-sm"
                            onClick={() => startEditUser(u)}
                          >
                            ✏️ Изменить
                          </button>
                        )}
                        {user?.role === "admin" && u.id !== user.id && (
                          <button
                            type="button"
                            className="crm-btn crm-btn-ghost crm-btn-sm"
                            style={{ color: "var(--danger)" }}
                            onClick={() => {
                              if (!window.confirm(`Удалить оператора «${u.name}»? Сессия будет завершена.`)) return;
                              deleteUserMutation.mutate(u.id);
                            }}
                          >
                            🗑 Удалить
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "general" && user?.role === "admin" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Общие настройки CRM</h3>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Заказы с Авито</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
                  При включении CRM автоматически создаёт заказ, когда клиент пишет по объявлению на Авито.
                  Дубликаты не создаются — один активный заказ на объявление у клиента.
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={avitoAutoDeals}
                    disabled={saveCrmMutation.isPending}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setAvitoAutoDeals(enabled);
                      saveCrmMutation.mutate({ avitoAutoDeals: enabled });
                    }}
                  />
                  Автозаказы с Авито
                </label>
              </SettingsCard>

              <SettingsCard style={{ marginTop: 12 }}>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Аванс CPA на Авито</p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
                  CRM проверяет <strong>баланс CPA</strong> (как «Аванс» в кабинете Авито) каждые 10 минут по всем аккаунтам.
                  Когда баланс ниже порога — срочное оповещение в CRM, звук и push в браузере.
                  <strong> SMS не отправляется</strong> — для сообщений на телефон укажите Telegram ниже.
                </p>
                {avitoCpaStatus?.configured && avitoCpaStatus.accounts?.length ? (
                  <div className="dash-avito-table" style={{ marginBottom: 12 }}>
                    {avitoCpaStatus.accounts.map((acc) => (
                      <div key={acc.channelId} className={`dash-avito-row dash-avito-row--${acc.level}`}>
                        <span className="dash-avito-row__name">{acc.channelName}</span>
                        <span>Баланс CPA: <strong style={{
                          color: acc.level === "empty" ? "var(--danger)"
                            : acc.level === "low" ? "var(--warning)" : "var(--success)",
                        }}>{(acc.cpaBalance ?? acc.advance)?.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) ?? "—"} ₽</strong></span>
                        <span>Кошелёк: {acc.wallet?.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) ?? "—"} ₽</span>
                        {acc.error && <span style={{ color: "var(--danger)", fontSize: 11 }}>{acc.error}</span>}
                      </div>
                    ))}
                    {avitoCpaStatus.checkedAt && (
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                        Обновлено: {new Date(avitoCpaStatus.checkedAt).toLocaleString("ru-RU")}
                      </div>
                    )}
                  </div>
                ) : avitoCpaStatus?.configured ? (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>Нет данных по аккаунтам.</p>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
                    Подключите канал Авито во вкладке «Каналы».
                  </p>
                )}
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginBottom: 12 }}>
                  <input
                    type="checkbox"
                    checked={avitoAdvanceAlert}
                    disabled={saveCrmMutation.isPending}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      setAvitoAdvanceAlert(enabled);
                      saveCrmMutation.mutate({ avitoAdvanceAlertEnabled: enabled });
                    }}
                  />
                  Уведомлять о низком авансе
                </label>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <label style={{ fontSize: 13 }}>Порог, ₽</label>
                  <input
                    className="crm-input"
                    type="number"
                    min={50}
                    max={10000}
                    style={{ width: 100 }}
                    value={avitoAdvanceThreshold}
                    disabled={saveCrmMutation.isPending}
                    onChange={(e) => setAvitoAdvanceThreshold(e.target.value)}
                    onBlur={() => {
                      const n = Math.max(50, Math.min(10000, parseInt(avitoAdvanceThreshold, 10) || 200));
                      setAvitoAdvanceThreshold(String(n));
                      saveCrmMutation.mutate({ avitoAdvanceThresholdRub: n });
                    }}
                  />
                  <button
                    type="button"
                    className="crm-btn crm-btn--secondary"
                    style={{ fontSize: 12 }}
                    disabled={!avitoCpaStatus?.configured || saveCrmMutation.isPending}
                    onClick={() => apiFetch("/api/avito/cpa-check", { method: "POST" })
                      .then(() => {
                        qc.invalidateQueries({ queryKey: ["avito-cpa-status"] });
                        toast("Проверка выполнена", "success");
                      })
                      .catch((e: Error) => toast(e.message, "error"))}
                  >
                    Проверить сейчас
                  </button>
                </div>
                <div style={{ marginTop: 12 }}>
                  <label style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
                    Telegram для срочных оповещений (chat id)
                  </label>
                  <input
                    className="crm-input"
                    placeholder="Например: 123456789 или -1001234567890"
                    value={advanceAlertTelegramChatId}
                    disabled={saveCrmMutation.isPending}
                    onChange={(e) => setAdvanceAlertTelegramChatId(e.target.value)}
                    onBlur={() => {
                      saveCrmMutation.mutate({
                        advanceAlertTelegramChatId: advanceAlertTelegramChatId.trim() || null,
                      });
                    }}
                    style={{ maxWidth: 320 }}
                  />
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
                    Нужен подключённый канал Telegram в CRM. Узнать свой id: напишите боту @userinfobot.
                    Сообщения приходят в Telegram при низком авансе (как SMS на телефон).
                  </p>
                </div>
              </SettingsCard>
            </>
          )}

          {tab === "general" && user?.role !== "admin" && (
            <p style={{ color: "var(--text-muted)" }}>Общие настройки доступны только администратору</p>
          )}

          {tab === "telephony" && user?.role === "admin" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Телефония Мегафон / МТС</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                Интеграция с облачной ВАТС: при входящем звонке в CRM открывается окно — оператор сразу вводит имя, причину, VIN, артикул и может поставить задачу.
                Исходящие — по кнопке «ВАТС» (сначала звонит оператору, затем клиенту).
                У каждого оператора укажите <strong>добавочный</strong> во вкладке «Операторы».
              </p>
              <SettingsCard>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={telEnabled} onChange={(e) => setTelEnabled(e.target.checked)} />
                  Включить интеграцию с ВАТС
                </label>
                <select className="crm-input" value={telProvider} onChange={(e) => setTelProvider(e.target.value as any)} style={{ marginBottom: 12, maxWidth: 280 }}>
                  <option value="none">Не выбрано</option>
                  <option value="megafon">Мегафон ВАТС</option>
                  <option value="mts">МТС Exolve</option>
                </select>
                {telProvider === "megafon" && (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    <input className="crm-input" placeholder="Адрес АТС (https://xxx.megapbx.ru)" value={megafonUrl} onChange={(e) => setMegafonUrl(e.target.value)} />
                    <input className="crm-input" placeholder="Ключ авторизации (crm_token)" value={megafonToken} onChange={(e) => setMegafonToken(e.target.value)} />
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      В ЛК Мегафон → Интеграция с CRM → REST API → укажите URL CRM:
                      <br /><code>{telData?.settings?.webhookUrls?.megafon || "…/api/webhooks/telephony/megafon"}</code>
                    </p>
                  </div>
                )}
                {telProvider === "mts" && (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    <input className="crm-input" placeholder="API-ключ Exolve" value={mtsKey} onChange={(e) => setMtsKey(e.target.value)} />
                    <input className="crm-input" placeholder="Application ID" value={mtsAppId} onChange={(e) => setMtsAppId(e.target.value)} />
                    <input className="crm-input" placeholder="Номер переадресации (если клиент не найден)" value={mtsRedirect} onChange={(e) => setMtsRedirect(e.target.value)} />
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      В ЛК Exolve → Переадресация вх. вызовов на URL:
                      <br /><code>{telData?.settings?.webhookUrls?.mts || "…/api/webhooks/telephony/mts"}</code>
                    </p>
                  </div>
                )}
                <input className="crm-input" placeholder="Секрет webhook (необязательно)" value={telWebhookSecret} onChange={(e) => setTelWebhookSecret(e.target.value)} style={{ marginBottom: 12 }} />
                <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginBottom: 12 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, fontSize: 13, cursor: "pointer" }}>
                    <input type="checkbox" checked={telLoadBalance} onChange={(e) => setTelLoadBalance(e.target.checked)} />
                    Распределение входящих между менеджерами (50/50 при двух, по очереди)
                  </label>
                  <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>
                    При включении звонки без закреплённого менеджера идут по очереди. Окно звонка видит только назначенный менеджер.
                    Для МТС CRM сама выбирает номер переадресации. Для Мегафон настройте в ЛК ВАТС отдел с обзвоном «по очереди».
                  </p>
                  {telLoadBalance && (
                    <div style={{ display: "grid", gap: 6 }}>
                      {(usersData?.users || [])
                        .filter((u: { isActive?: boolean; phoneExtension?: string | null }) => u.isActive && u.phoneExtension)
                        .map((u: { id: number; name: string; phoneExtension?: string | null }) => (
                          <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                            <input
                              type="checkbox"
                              checked={telLoadBalanceUsers.includes(u.id)}
                              onChange={(e) => {
                                setTelLoadBalanceUsers((prev) => e.target.checked
                                  ? [...prev, u.id]
                                  : prev.filter((id) => id !== u.id));
                              }}
                            />
                            {u.name} <span style={{ color: "var(--text-muted)" }}>(доб. {u.phoneExtension})</span>
                          </label>
                        ))}
                      {!((usersData?.users || []).some((u: { isActive?: boolean; phoneExtension?: string | null }) => u.isActive && u.phoneExtension)) && (
                        <p style={{ fontSize: 12, color: "var(--warning)" }}>Сначала укажите добавочные номера операторам во вкладке «Операторы».</p>
                      )}
                      {telLoadBalanceUsers.length === 0 && (
                        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>Если никого не выбрать — участвуют все операторы с добавочным.</p>
                      )}
                    </div>
                  )}
                </div>
                <button type="button" className="crm-btn" onClick={() => saveTelMutation.mutate()} disabled={saveTelMutation.isPending}>
                  Сохранить
                </button>
                <button
                  type="button"
                  className="crm-btn crm-btn-secondary"
                  style={{ marginLeft: 8 }}
                  onClick={() => apiFetch("/api/telephony/test-incoming", { method: "POST", body: JSON.stringify({}) })
                    .then(() => toast("Тестовый звонок отправлен — должно открыться окно", "success"))
                    .catch((e: Error) => toast(e.message, "error"))}
                >
                  Проверить окно звонка
                </button>
              </SettingsCard>
            </>
          )}

          {tab === "telephony" && user?.role !== "admin" && (
            <p style={{ color: "var(--text-muted)" }}>Настройка телефонии доступна только администратору</p>
          )}

          {tab === "cdek" && user?.role === "admin" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Интеграция СДЭК</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
                Отправка посылок из карточки заказа: выбор ПВЗ, расчёт тарифа, трек-номер.
                Ключи выдаются после договора с СДЭК в <a href="https://www.cdek.ru/clients/integrator.html" target="_blank" rel="noreferrer">личном кабинете</a>.
              </p>
              <SettingsCard>
                <p style={{ fontSize: 13, marginBottom: 10 }}>
                  Статус:{" "}
                  <span style={{ color: cdekStatus?.configured ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                    {cdekStatus?.configured ? "Подключено" : "Не настроено"}
                  </span>
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={cdekEnabled} onChange={(e) => setCdekEnabled(e.target.checked)} />
                  Включить СДЭК
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={cdekTestMode} onChange={(e) => setCdekTestMode(e.target.checked)} />
                  Тестовый API (api.edu.cdek.ru)
                </label>
                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  <input className="crm-input" placeholder="Account (client_id)" value={cdekClientId} onChange={(e) => setCdekClientId(e.target.value)} />
                  <input className="crm-input" placeholder="Secure password (client_secret)" type="password" value={cdekClientSecret} onChange={(e) => setCdekClientSecret(e.target.value)} />
                  <input className="crm-input" placeholder="Код ПВЗ отправки (напр. MSK1)" value={cdekShipmentPoint} onChange={(e) => setCdekShipmentPoint(e.target.value)} />
                  <input className="crm-input" placeholder="Код города отправления (напр. 44 — Москва)" value={cdekFromCity} onChange={(e) => setCdekFromCity(e.target.value)} />
                  <input className="crm-input" placeholder="Тариф по умолчанию (136 — склад-склад)" value={cdekTariff} onChange={(e) => setCdekTariff(e.target.value)} />
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                  Ключи можно задать в <code>.env</code>: <code>CDEK_CLIENT_ID</code>, <code>CDEK_CLIENT_SECRET</code>, <code>CDEK_ENABLED=true</code>, <code>CDEK_TEST_MODE=false</code>.
                  Опционально: <code>CDEK_SHIPMENT_POINT</code>, <code>CDEK_FROM_CITY_CODE</code> (код города отправки).
                </p>
                <button type="button" className="crm-btn" onClick={() => saveCdekMutation.mutate()} disabled={saveCdekMutation.isPending}>
                  Сохранить
                </button>
              </SettingsCard>
            </>
          )}

          {tab === "cdek" && user?.role !== "admin" && (
            <p style={{ color: "var(--text-muted)" }}>Настройка СДЭК доступна только администратору</p>
          )}

          {tab === "ai" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>YandexGPT — помощник операторам</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                В чате кнопки <strong>✨ Алиса</strong>, «Улучшить текст», «Резюме чата». Используется API Yandex Cloud (модель Alice / YandexGPT).
              </p>
              <div className="crm-card" style={{ padding: 16, borderRadius: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, marginBottom: 8 }}>
                  Статус:{" "}
                  <span style={{ color: aiStatus?.configured ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                    {aiStatus?.configured ? `Подключено (${aiStatus.model})` : "Не настроено"}
                  </span>
                </p>
                {aiStatus?.missing && aiStatus.missing.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>
                    Не хватает в .env: <strong>{aiStatus.missing.join(", ")}</strong>
                  </p>
                )}
                {!aiStatus?.configured && (
                  <ol style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8, paddingLeft: 18 }}>
                    <li>Зайдите в <a href="https://console.yandex.cloud" target="_blank" rel="noreferrer">console.yandex.cloud</a></li>
                    <li>Создайте каталог (folder) → скопируйте <strong>Folder ID</strong></li>
                    <li>Сервисный аккаунт → API-ключ с правом <code>yc.ai.foundationModels.execute</code></li>
                    <li>В файл <code>.env</code> на сервере добавьте:</li>
                  </ol>
                )}
                <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 8, fontSize: 11, marginTop: 8, overflow: "auto" }}>
{`YANDEX_API_KEY=ваш_api_ключ
YANDEX_FOLDER_ID=ваш_folder_id
YANDEX_MODEL=yandexgpt-lite`}
                </pre>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  Для модели «Про»: <code>YANDEX_MODEL=yandexgpt</code>. После изменения .env: <code>pm2 restart crm</code>
                </p>
              </div>
            </>
          )}

          {tab === "channels" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Каналы и мессенджеры</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                Подключите Telegram, Авито, WhatsApp, VK. Входящие сообщения приходят по webhook.
                Для Авито нужен публичный HTTPS-адрес (укажите PUBLIC_URL в .env).
              </p>
              {user?.role === "admin" && (
                <SettingsCard>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>Добавить канал</p>
                  <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input className="crm-input" placeholder="Название" value={newChannelName} onChange={e => setNewChannelName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                      <select className="crm-input" value={newChannelType} onChange={e => setNewChannelType(e.target.value)} style={{ width: 140 }}>
                        <option value="telegram">Telegram</option>
                        <option value="avito">Авито</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="vk">ВКонтакте</option>
                        <option value="instagram">Instagram</option>
                        <option value="manual">Вручную</option>
                      </select>
                    </div>
                    {newChannelType === "telegram" && (
                      <>
                        <input className="crm-input" placeholder="Bot Token от @BotFather" value={chBotToken} onChange={e => setChBotToken(e.target.value)} />
                        <input className="crm-input" placeholder="Webhook Secret (secret_token в setWebhook)" value={chWebhookSecret} onChange={e => setChWebhookSecret(e.target.value)} />
                        <p style={{ fontSize: 11, color: "var(--text-muted)" }}>В проде без secret_token webhook Telegram будет отклонён.</p>
                      </>
                    )}
                    {newChannelType === "avito" && (
                      <>
                        <input className="crm-input" placeholder="Client ID (developers.avito.ru)" value={chClientId} onChange={e => setChClientId(e.target.value)} />
                        <input className="crm-input" placeholder="Client Secret" type="password" value={chClientSecret} onChange={e => setChClientSecret(e.target.value)} />
                        <input className="crm-input" placeholder="User ID аккаунта Авито" value={chUserId} onChange={e => setChUserId(e.target.value)} />
                        <input className="crm-input" placeholder="Webhook Secret (обязателен в проде)" value={chWebhookSecret} onChange={e => setChWebhookSecret(e.target.value)} />
                      </>
                    )}
                    {newChannelType === "whatsapp" && (
                      <>
                        <input className="crm-input" placeholder="Phone Number ID" value={chPhoneNumberId} onChange={e => setChPhoneNumberId(e.target.value)} />
                        <input className="crm-input" placeholder="WhatsApp Access Token" type="password" value={chWhatsappToken} onChange={e => setChWhatsappToken(e.target.value)} />
                        <input className="crm-input" placeholder="Шаблон рассылки Meta (напр. hello_world)" value={chWhatsappTemplate} onChange={e => setChWhatsappTemplate(e.target.value)} />
                        <input className="crm-input" placeholder="Язык шаблона (ru)" value={chWhatsappTemplateLang} onChange={e => setChWhatsappTemplateLang(e.target.value)} />
                        <p style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.4 }}>
                          Для рассылок клиентам, которые не писали 24 часа, нужен одобренный шаблон в Meta Business. Текст рассылки подставится в переменную {"{{1}}"} шаблона.
                        </p>
                        <input className="crm-input" placeholder="Verify Token (для подтверждения webhook)" value={chVerifyToken} onChange={e => setChVerifyToken(e.target.value)} />
                        <input className="crm-input" placeholder="App Secret Meta (X-Hub-Signature-256)" type="password" value={chAppSecret} onChange={e => setChAppSecret(e.target.value)} />
                        <input className="crm-input" placeholder="Webhook Secret (если нет App Secret)" value={chWebhookSecret} onChange={e => setChWebhookSecret(e.target.value)} />
                      </>
                    )}
                    {newChannelType === "vk" && (
                      <>
                        <input className="crm-input" placeholder="Токен сообщества VK" type="password" value={chVkToken} onChange={e => setChVkToken(e.target.value)} />
                        <input className="crm-input" placeholder="Secret для Callback API" value={chWebhookSecret} onChange={e => setChWebhookSecret(e.target.value)} />
                      </>
                    )}
                    {channelError && <p style={{ color: "var(--danger)", fontSize: 12 }}>{channelError}</p>}
                    <button
                      type="button"
                      className="crm-btn"
                      onClick={() => createChannelMutation.mutate()}
                      disabled={!newChannelName.trim() || createChannelMutation.isPending}
                      style={{ height: 36, width: "fit-content" }}
                    >
                      {createChannelMutation.isPending ? "Подключение..." : "+ Подключить канал"}
                    </button>
                  </div>
                </SettingsCard>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {channels.map((ch: any) => {
                  const webhookUrl = ch.webhookUrl || `${window.location.origin}/api/webhooks/${ch.type}/${ch.slug || ch.id}`;
                  const icons: Record<string, string> = { telegram: "✈️", avito: "🏠", whatsapp: "📱", vk: "🔵", instagram: "📸", manual: "✏️" };
                  return (
                    <div key={ch.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                        <span style={{ fontSize: 20 }}>{icons[ch.type] || "📡"}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 600, fontSize: 13 }}>{ch.name}</p>
                          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{ch.type} · {ch.slug}</p>
                        </div>
                        {user?.role === "admin" && (
                          <button type="button" className="crm-btn crm-btn-ghost" style={{ height: 28, fontSize: 11 }} onClick={() => testChannelMutation.mutate(ch.id)}>
                            Проверить
                          </button>
                        )}
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: ch.isActive ? "var(--success)" : "var(--text-muted)" }} />
                        {user?.role === "admin" && (
                          <button type="button" onClick={() => deleteChannelMutation.mutate(ch.id)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>🗑</button>
                        )}
                      </div>
                      {ch.setupHint && <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{ch.setupHint}</p>}
                      <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 12px", fontSize: 11, fontFamily: "monospace", color: "var(--accent)", wordBreak: "break-all" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: 10, display: "block", marginBottom: 2 }}>Webhook URL (вставьте в Авито / Meta / VK):</span>
                        {webhookUrl}
                      </div>
                    </div>
                  );
                })}
                {channels.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Каналы не добавлены. Добавьте Авито или Telegram выше.</p>}
              </div>
            </>
          )}

          {tab === "sales" && user?.role === "admin" && (
            <SalesSettingsSection />
          )}

        </div>
      </div>
    </AppShell>
  );
}
