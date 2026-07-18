import { useState, useCallback, type ReactNode } from "react";
import { useSettingsSync } from "../lib/use-form-sync";
import { uploadImageFile } from "../lib/upload";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, apiFetchVoid } from "../lib/fetch-api";
import { useAuth } from "../lib/auth";
import { AppShell } from "../components/AppShell";
import { TagBadge } from "../components/TagBadge";
import { useToast } from "../lib/toast";
import { TEMPLATE_CATEGORIES, TEMPLATE_VARS, categoryLabel } from "../lib/templates";
import { SalesSettingsSection } from "../components/settings/SalesSettingsSection";

const THEMES = [
  { id: "dark-navy", label: "╨в╤С╨╝╨╜╨╛-╤Б╨╕╨╜╤П╤П", preview: ["#0f1629", "#2563eb"] },
  { id: "midnight", label: "╨Я╨╛╨╗╨╜╨╛╤З╤М", preview: ["#0a0a0f", "#7c3aed"] },
  { id: "dark-teal", label: "╨в╤С╨╝╨╜╤Л╨╣ ╨▒╨╕╤А╤О╨╖╨╛╨▓╤Л╨╣", preview: ["#0d1f1f", "#0d9488"] },
  { id: "light", label: "╨б╨▓╨╡╤В╨╗╨░╤П", preview: ["#f8fafc", "#2563eb"] },
  { id: "telegram", label: "Telegram", preview: ["#efeff3", "#2aabee"] },
];

const TAG_COLORS = ["#ef4444","#f97316","#eab308","#22c55e","#3b82f6","#8b5cf6","#ec4899","#06b6d4","#6b7280","#f59e0b","#a855f7","#10b981"];

function SettingsCard({ children }: { children: ReactNode }) {
  return (
    <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 12, padding: 20, marginBottom: 16 }}>{children}</div>
  );
}

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [tab, setTab] = useState<"themes" | "tags" | "templates" | "users" | "channels" | "telephony" | "cdek" | "ai" | "sales">("themes");

  // Tags
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#3b82f6");

  // Users
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newUserRole, setNewUserRole] = useState<"operator" | "admin">("operator");

  // Channels
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState("telegram");
  const [chBotToken, setChBotToken] = useState("");
  const [chClientId, setChClientId] = useState("");
  const [chClientSecret, setChClientSecret] = useState("");
  const [chUserId, setChUserId] = useState("");
  const [chPhoneNumberId, setChPhoneNumberId] = useState("");
  const [chWhatsappToken, setChWhatsappToken] = useState("");
  const [chVerifyToken, setChVerifyToken] = useState("");
  const [chVkToken, setChVkToken] = useState("");
  const [chWebhookSecret, setChWebhookSecret] = useState("");
  const [channelError, setChannelError] = useState("");
  const [tplTitle, setTplTitle] = useState("");
  const [tplText, setTplText] = useState("");
  const [tplCategory, setTplCategory] = useState("general");
  const [editTplId, setEditTplId] = useState<number | null>(null);
  const [editTplTitle, setEditTplTitle] = useState("");
  const [editTplText, setEditTplText] = useState("");
  const [tplImageUrl, setTplImageUrl] = useState<string | null>(null);
  const [editTplImageUrl, setEditTplImageUrl] = useState<string | null>(null);
  const [telProvider, setTelProvider] = useState<"none" | "megafon" | "mts">("none");
  const [telEnabled, setTelEnabled] = useState(false);
  const [megafonUrl, setMegafonUrl] = useState("");
  const [megafonToken, setMegafonToken] = useState("");
  const [mtsKey, setMtsKey] = useState("");
  const [mtsAppId, setMtsAppId] = useState("");
  const [mtsRedirect, setMtsRedirect] = useState("");
  const [telWebhookSecret, setTelWebhookSecret] = useState("");
  const [extEdits, setExtEdits] = useState<Record<number, string>>({});
  const [cdekEnabled, setCdekEnabled] = useState(false);
  const [cdekTestMode, setCdekTestMode] = useState(true);
  const [cdekClientId, setCdekClientId] = useState("");
  const [cdekClientSecret, setCdekClientSecret] = useState("");
  const [cdekShipmentPoint, setCdekShipmentPoint] = useState("");
  const [cdekFromCity, setCdekFromCity] = useState("");
  const [cdekTariff, setCdekTariff] = useState("136");

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

  useSettingsSync("telephony", tab, !!telData?.settings, syncTelSettings);
  useSettingsSync("cdek", tab, !!cdekData?.settings, syncCdekSettings);

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
      toast("╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╨б╨Ф╨н╨Ъ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╤Л", "success");
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
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["telephony-settings"] });
      qc.invalidateQueries({ queryKey: ["telephony-status"] });
      toast("╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕ ╤В╨╡╨╗╨╡╤Д╨╛╨╜╨╕╨╕ ╤Б╨╛╤Е╤А╨░╨╜╨╡╨╜╤Л", "success");
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); toast("╨Ф╨╛╨▒╨░╨▓╨╛╤З╨╜╤Л╨╣ ╤Б╨╛╤Е╤А╨░╨╜╤С╨╜", "success"); },
  });

  const createTplMutation = useMutation({
    mutationFn: () => apiFetch("/api/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: tplTitle, text: tplText, category: tplCategory, sortOrder: 0, imageUrl: tplImageUrl }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setTplTitle(""); setTplText(""); setTplImageUrl(null);
      toast("╨и╨░╨▒╨╗╨╛╨╜ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜", "success");
    },
  });

  const updateTplMutation = useMutation({
    mutationFn: ({ id, title, text, category, imageUrl }: { id: number; title: string; text: string; category?: string; imageUrl?: string | null }) =>
      apiFetch(`/api/templates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text, category, imageUrl: imageUrl || null }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["templates"] });
      setEditTplId(null);
      toast("╨и╨░╨▒╨╗╨╛╨╜ ╨╛╨▒╨╜╨╛╨▓╨╗╤С╨╜", "success");
    },
  });

  const deleteTplMutation = useMutation({
    mutationFn: (id: number) => apiFetchVoid(`/api/templates/${id}`, { method: "DELETE" }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["templates"] }); toast("╨и╨░╨▒╨╗╨╛╨╜ ╤Г╨┤╨░╨╗╤С╨╜", "info"); },
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); setNewUserName(""); setNewUserEmail(""); setNewUserPassword(""); },
  });

  const toggleUserMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });

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
          verifyToken: chVerifyToken || undefined,
          vkToken: chVkToken || undefined,
          webhookSecret: chWebhookSecret || undefined,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["channels"] });
      setNewChannelName("");
      setChBotToken(""); setChClientId(""); setChClientSecret(""); setChUserId("");
      setChPhoneNumberId(""); setChWhatsappToken(""); setChVerifyToken(""); setChVkToken("");
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
      <div style={{ display: "flex", overflow: "hidden", flex: 1 }}>
        {/* Settings nav */}
        <div style={{ width: 200, borderRight: "1px solid var(--border)", padding: 16, flexShrink: 0 }}>
          <h2 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨╕</h2>
          {(["themes", "tags", "templates", "users", "channels", "telephony", "cdek", "ai", "sales"] as const).map(t => (
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
              {{ themes: "ЁЯОи ╨в╨╡╨╝╤Л", tags: "ЁЯП╖я╕П ╨Ь╨╡╤В╨║╨╕", templates: "ЁЯТм ╨и╨░╨▒╨╗╨╛╨╜╤Л", users: "ЁЯСе ╨Ю╨┐╨╡╤А╨░╤В╨╛╤А╤Л", channels: "ЁЯУб ╨Ъ╨░╨╜╨░╨╗╤Л", telephony: "ЁЯУЮ ╨в╨╡╨╗╨╡╤Д╨╛╨╜╨╕╤П", cdek: "ЁЯУж ╨б╨Ф╨н╨Ъ", ai: "тЬи ╨Р╨╗╨╕╤Б╨░ / ╨Ш╨Ш" , sales: "🧾 Реализация" }[t]}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {tab === "themes" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>╨в╨╡╨╝╨░ ╨╕╨╜╤В╨╡╤А╤Д╨╡╨╣╤Б╨░</h3>
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
                      <p style={{ fontSize: 10, color: "var(--accent)", marginTop: 4 }}>тЬУ ╨Р╨║╤В╨╕╨▓╨╜╨░</p>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}

          {tab === "templates" && (
            <>
              <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>╨и╨░╨▒╨╗╨╛╨╜╤Л ╨╛╤В╨▓╨╡╤В╨╛╨▓ ╨┤╨╗╤П ╨╛╨┐╨╡╤А╨░╤В╨╛╤А╨╛╨▓</h3>
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                ╨Я╨╡╤А╨╡╨╝╨╡╨╜╨╜╤Л╨╡ ╨▓ ╤В╨╡╨║╤Б╤В╨╡: {TEMPLATE_VARS.map((v) => v.key).join(", ")} тАФ ╨┐╨╛╨┤╤Б╤В╨░╨▓╨╗╤П╤О╤В╤Б╤П ╨░╨▓╤В╨╛╨╝╨░╤В╨╕╤З╨╡╤Б╨║╨╕ ╨╕╨╖ ╨║╨░╤А╤В╨╛╤З╨║╨╕ ╨║╨╗╨╕╨╡╨╜╤В╨░
              </p>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>╨Э╨╛╨▓╤Л╨╣ ╤И╨░╨▒╨╗╨╛╨╜</p>
                <input className="crm-input" placeholder="╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ (╨║╨╜╨╛╨┐╨║╨░)" value={tplTitle} onChange={e => setTplTitle(e.target.value)} style={{ marginBottom: 8 }} />
                <textarea className="crm-input" placeholder="╨Ч╨┤╤А╨░╨▓╤Б╤В╨▓╤Г╨╣╤В╨╡, {╨╕╨╝╤П}! ╨Я╨╛ VIN {vin}..." value={tplText} onChange={e => setTplText(e.target.value)} style={{ height: 80, resize: "none", marginBottom: 8 }} />
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
                  <label className="crm-btn crm-btn-ghost crm-btn-sm" style={{ cursor: "pointer" }}>
                    ЁЯУ╖ ╨д╨╛╤В╨╛ ╨║ ╤И╨░╨▒╨╗╨╛╨╜╤Г
                    <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      try { setTplImageUrl(await uploadImageFile(f)); toast("╨д╨╛╤В╨╛ ╨┐╤А╨╕╨║╤А╨╡╨┐╨╗╨╡╨╜╨╛", "success"); }
                      catch (err: any) { toast(err.message, "error"); }
                    }} />
                  </label>
                  {tplImageUrl && <img src={tplImageUrl} alt="" style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />}
                  {tplImageUrl && <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setTplImageUrl(null)}>тЬХ ╤Д╨╛╤В╨╛</button>}
                </div>
                <select className="crm-input" value={tplCategory} onChange={e => setTplCategory(e.target.value)} style={{ marginBottom: 10, maxWidth: 200 }}>
                  {TEMPLATE_CATEGORIES.filter(c => c.id).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
                <button className="crm-btn" onClick={() => tplTitle && tplText && createTplMutation.mutate()}>╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╤И╨░╨▒╨╗╨╛╨╜</button>
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
                            ЁЯУ╖ ╨д╨╛╤В╨╛
                            <input type="file" accept="image/*" style={{ display: "none" }} onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try { setEditTplImageUrl(await uploadImageFile(f)); toast("╨д╨╛╤В╨╛ ╨╛╨▒╨╜╨╛╨▓╨╗╨╡╨╜╨╛", "success"); }
                              catch (err: any) { toast(err.message, "error"); }
                            }} />
                          </label>
                          {editTplImageUrl && <img src={editTplImageUrl} alt="" style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />}
                          {editTplImageUrl && <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setEditTplImageUrl(null)}>тЬХ</button>}
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                          <button type="button" className="crm-btn crm-btn-sm" onClick={() => updateTplMutation.mutate({ id: t.id, title: editTplTitle, text: editTplText, imageUrl: editTplImageUrl })}>╨б╨╛╤Е╤А╨░╨╜╨╕╤В╤М</button>
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => setEditTplId(null)}>╨Ю╤В╨╝╨╡╨╜╨░</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                          <strong style={{ fontSize: 13 }}>{t.title}</strong>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button type="button" onClick={() => { setEditTplId(t.id); setEditTplTitle(t.title); setEditTplText(t.text); setEditTplImageUrl(t.imageUrl || null); }} style={{ background: "none", border: "none", cursor: "pointer" }}>тЬПя╕П</button>
                            <button type="button" onClick={() => deleteTplMutation.mutate(t.id)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer" }}>ЁЯЧС</button>
                          </div>
                        </div>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.text}</p>
                        {t.imageUrl && <img src={t.imageUrl} alt="" style={{ maxWidth: 120, marginTop: 8, borderRadius: 6 }} />}
                        <span className="chip" style={{ marginTop: 8, display: "inline-block" }}>{categoryLabel(t.category)}</span>
                      </>
                    )}
                  </div>
                ))}
                {templates.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>╨Э╨╡╤В ╤И╨░╨▒╨╗╨╛╨╜╨╛╨▓ тАФ ╨┤╨╛╨▒╨░╨▓╤М╤В╨╡ ╤В╨╕╨┐╨╛╨▓╤Л╨╡ ╨╛╤В╨▓╨╡╤В╤Л ╨┤╨╗╤П ╨╛╨┐╨╡╤А╨░╤В╨╛╤А╨╛╨▓</p>}
              </div>
            </>
          )}

          {tab === "tags" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>╨г╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╨╡ ╨╝╨╡╤В╨║╨░╨╝╨╕</h3>
              <SettingsCard>
                <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>╨б╨╛╨╖╨┤╨░╤В╤М ╨╝╨╡╤В╨║╤Г</p>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
                  <input className="crm-input" placeholder="╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡ ╨╝╨╡╤В╨║╨╕" value={newTagName} onChange={e => setNewTagName(e.target.value)} style={{ width: 200 }} />
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
                  <button className="crm-btn" onClick={() => newTagName && createTagMutation.mutate()} style={{ height: 36 }}>
                    + ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М
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
                      >├Ч</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "users" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 16 }}>╨Ю╨┐╨╡╤А╨░╤В╨╛╤А╤Л</h3>
              {user?.role === "admin" && (
                <SettingsCard>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╨╛╨┐╨╡╤А╨░╤В╨╛╤А╨░</p>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <input className="crm-input" placeholder="╨Ш╨╝╤П" value={newUserName} onChange={e => setNewUserName(e.target.value)} style={{ width: 160 }} />
                    <input className="crm-input" placeholder="Email" type="email" value={newUserEmail} onChange={e => setNewUserEmail(e.target.value)} style={{ width: 200 }} />
                    <input className="crm-input" placeholder="╨Я╨░╤А╨╛╨╗╤М" type="password" value={newUserPassword} onChange={e => setNewUserPassword(e.target.value)} style={{ width: 140 }} />
                    <select className="crm-input" value={newUserRole} onChange={e => setNewUserRole(e.target.value as any)} style={{ width: 120 }}>
                      <option value="operator">╨Ю╨┐╨╡╤А╨░╤В╨╛╤А</option>
                      <option value="admin">╨Р╨┤╨╝╨╕╨╜╨╕╤Б╤В╤А╨░╤В╨╛╤А</option>
                    </select>
                    <button className="crm-btn" onClick={() => newUserName && newUserEmail && newUserPassword && createUserMutation.mutate()} style={{ height: 36 }}>
                      + ╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М
                    </button>
                  </div>
                </SettingsCard>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {users.map((u: any) => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}>
                    <div style={{ width: 36, height: 36, borderRadius: "50%", background: "var(--accent)33", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14 }}>
                      {u.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontWeight: 600, fontSize: 13 }}>{u.name}</p>
                      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>{u.email}</p>
                    </div>
                    <span style={{
                      padding: "2px 10px", borderRadius: 999, fontSize: 11, fontWeight: 600,
                      background: u.role === "admin" ? "var(--warning)22" : "var(--accent)22",
                      color: u.role === "admin" ? "var(--warning)" : "var(--accent)",
                    }}>{u.role === "admin" ? "╨Р╨┤╨╝╨╕╨╜╨╕╤Б╤В╤А╨░╤В╨╛╤А" : "╨Ю╨┐╨╡╤А╨░╤В╨╛╤А"}</span>
                    <span style={{
                      width: 8, height: 8, borderRadius: "50%",
                      background: u.isActive ? "var(--success)" : "var(--danger)",
                    }} />
                    <input
                      className="crm-input"
                      placeholder="╨Ф╨╛╨▒╨░╨▓╨╛╤З╨╜╤Л╨╣ ╨Т╨Р╨в╨б"
                      value={extEdits[u.id] ?? u.phoneExtension ?? ""}
                      onChange={(e) => setExtEdits({ ...extEdits, [u.id]: e.target.value })}
                      style={{ width: 110, fontSize: 11 }}
                      title="╨Т╨╜╤Г╤В╤А╨╡╨╜╨╜╨╕╨╣ ╨╜╨╛╨╝╨╡╤А ╨▓ ╨Ь╨╡╨│╨░╤Д╨╛╨╜ ╨Т╨Р╨в╨б ╨╕╨╗╨╕ ╨╝╨╛╨▒╨╕╨╗╤М╨╜╤Л╨╣ ╨┤╨╗╤П ╨Ь╨в╨б"
                    />
                    {user?.role === "admin" && (
                      <button
                        type="button"
                        onClick={() => saveExtMutation.mutate({ id: u.id, phoneExtension: extEdits[u.id] ?? u.phoneExtension ?? "" })}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "var(--text-muted)" }}
                      >ЁЯТ╛</button>
                    )}
                    {user?.role === "admin" && u.id !== user.id && (
                      <button
                        onClick={() => toggleUserMutation.mutate({ id: u.id, isActive: !u.isActive })}
                        style={{ background: "none", border: "1px solid var(--border)", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 11, color: "var(--text-muted)" }}
                      >{u.isActive ? "╨Ф╨╡╨░╨║╤В╨╕╨▓╨╕╤А╨╛╨▓╨░╤В╤М" : "╨Р╨║╤В╨╕╨▓╨╕╤А╨╛╨▓╨░╤В╤М"}</button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {tab === "telephony" && user?.role === "admin" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>╨в╨╡╨╗╨╡╤Д╨╛╨╜╨╕╤П ╨Ь╨╡╨│╨░╤Д╨╛╨╜ / ╨Ь╨в╨б</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                ╨Ш╨╜╤В╨╡╨│╤А╨░╤Ж╨╕╤П ╤Б ╨╛╨▒╨╗╨░╤З╨╜╨╛╨╣ ╨Т╨Р╨в╨б: ╨▓╤Е╨╛╨┤╤П╤Й╨╕╨╡ ╨╖╨▓╨╛╨╜╨║╨╕ ╨▓ CRM, ╨╕╤Б╤Е╨╛╨┤╤П╤Й╨╕╨╡ ╨┐╨╛ ╨║╨╜╨╛╨┐╨║╨╡ ┬л╨Т╨Р╨в╨б┬╗ (╤Б╨╜╨░╤З╨░╨╗╨░ ╨╖╨▓╨╛╨╜╨╕╤В ╨╛╨┐╨╡╤А╨░╤В╨╛╤А╤Г, ╨╖╨░╤В╨╡╨╝ ╨║╨╗╨╕╨╡╨╜╤В╤Г).
                ╨г ╨║╨░╨╢╨┤╨╛╨│╨╛ ╨╛╨┐╨╡╤А╨░╤В╨╛╤А╨░ ╤Г╨║╨░╨╢╨╕╤В╨╡ <strong>╨┤╨╛╨▒╨░╨▓╨╛╤З╨╜╤Л╨╣</strong> ╨▓╨╛ ╨▓╨║╨╗╨░╨┤╨║╨╡ ┬л╨Ю╨┐╨╡╤А╨░╤В╨╛╤А╤Л┬╗.
              </p>
              <SettingsCard>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={telEnabled} onChange={(e) => setTelEnabled(e.target.checked)} />
                  ╨Т╨║╨╗╤О╤З╨╕╤В╤М ╨╕╨╜╤В╨╡╨│╤А╨░╤Ж╨╕╤О ╤Б ╨Т╨Р╨в╨б
                </label>
                <select className="crm-input" value={telProvider} onChange={(e) => setTelProvider(e.target.value as any)} style={{ marginBottom: 12, maxWidth: 280 }}>
                  <option value="none">╨Э╨╡ ╨▓╤Л╨▒╤А╨░╨╜╨╛</option>
                  <option value="megafon">╨Ь╨╡╨│╨░╤Д╨╛╨╜ ╨Т╨Р╨в╨б</option>
                  <option value="mts">╨Ь╨в╨б Exolve</option>
                </select>
                {telProvider === "megafon" && (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    <input className="crm-input" placeholder="╨Р╨┤╤А╨╡╤Б ╨Р╨в╨б (https://xxx.megapbx.ru)" value={megafonUrl} onChange={(e) => setMegafonUrl(e.target.value)} />
                    <input className="crm-input" placeholder="╨Ъ╨╗╤О╤З ╨░╨▓╤В╨╛╤А╨╕╨╖╨░╤Ж╨╕╨╕ (crm_token)" value={megafonToken} onChange={(e) => setMegafonToken(e.target.value)} />
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      ╨Т ╨Ы╨Ъ ╨Ь╨╡╨│╨░╤Д╨╛╨╜ тЖТ ╨Ш╨╜╤В╨╡╨│╤А╨░╤Ж╨╕╤П ╤Б CRM тЖТ REST API тЖТ ╤Г╨║╨░╨╢╨╕╤В╨╡ URL CRM:
                      <br /><code>{telData?.settings?.webhookUrls?.megafon || "тАж/api/webhooks/telephony/megafon"}</code>
                    </p>
                  </div>
                )}
                {telProvider === "mts" && (
                  <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                    <input className="crm-input" placeholder="API-╨║╨╗╤О╤З Exolve" value={mtsKey} onChange={(e) => setMtsKey(e.target.value)} />
                    <input className="crm-input" placeholder="Application ID" value={mtsAppId} onChange={(e) => setMtsAppId(e.target.value)} />
                    <input className="crm-input" placeholder="╨Э╨╛╨╝╨╡╤А ╨┐╨╡╤А╨╡╨░╨┤╤А╨╡╤Б╨░╤Ж╨╕╨╕ (╨╡╤Б╨╗╨╕ ╨║╨╗╨╕╨╡╨╜╤В ╨╜╨╡ ╨╜╨░╨╣╨┤╨╡╨╜)" value={mtsRedirect} onChange={(e) => setMtsRedirect(e.target.value)} />
                    <p style={{ fontSize: 11, color: "var(--text-muted)" }}>
                      ╨Т ╨Ы╨Ъ Exolve тЖТ ╨Я╨╡╤А╨╡╨░╨┤╤А╨╡╤Б╨░╤Ж╨╕╤П ╨▓╤Е. ╨▓╤Л╨╖╨╛╨▓╨╛╨▓ ╨╜╨░ URL:
                      <br /><code>{telData?.settings?.webhookUrls?.mts || "тАж/api/webhooks/telephony/mts"}</code>
                    </p>
                  </div>
                )}
                <input className="crm-input" placeholder="╨б╨╡╨║╤А╨╡╤В webhook (╨╜╨╡╨╛╨▒╤П╨╖╨░╤В╨╡╨╗╤М╨╜╨╛)" value={telWebhookSecret} onChange={(e) => setTelWebhookSecret(e.target.value)} style={{ marginBottom: 12 }} />
                <button type="button" className="crm-btn" onClick={() => saveTelMutation.mutate()} disabled={saveTelMutation.isPending}>
                  ╨б╨╛╤Е╤А╨░╨╜╨╕╤В╤М
                </button>
              </SettingsCard>
            </>
          )}

          {tab === "telephony" && user?.role !== "admin" && (
            <p style={{ color: "var(--text-muted)" }}>╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨░ ╤В╨╡╨╗╨╡╤Д╨╛╨╜╨╕╨╕ ╨┤╨╛╤Б╤В╤Г╨┐╨╜╨░ ╤В╨╛╨╗╤М╨║╨╛ ╨░╨┤╨╝╨╕╨╜╨╕╤Б╤В╤А╨░╤В╨╛╤А╤Г</p>
          )}

          {tab === "cdek" && user?.role === "admin" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>╨Ш╨╜╤В╨╡╨│╤А╨░╤Ж╨╕╤П ╨б╨Ф╨н╨Ъ</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12, lineHeight: 1.6 }}>
                ╨Ю╤В╨┐╤А╨░╨▓╨║╨░ ╨┐╨╛╤Б╤Л╨╗╨╛╨║ ╨╕╨╖ ╨║╨░╤А╤В╨╛╤З╨║╨╕ ╨╖╨░╨║╨░╨╖╨░: ╨▓╤Л╨▒╨╛╤А ╨Я╨Т╨Ч, ╤А╨░╤Б╤З╤С╤В ╤В╨░╤А╨╕╤Д╨░, ╤В╤А╨╡╨║-╨╜╨╛╨╝╨╡╤А.
                ╨Ъ╨╗╤О╤З╨╕ ╨▓╤Л╨┤╨░╤О╤В╤Б╤П ╨┐╨╛╤Б╨╗╨╡ ╨┤╨╛╨│╨╛╨▓╨╛╤А╨░ ╤Б ╨б╨Ф╨н╨Ъ ╨▓ <a href="https://www.cdek.ru/clients/integrator.html" target="_blank" rel="noreferrer">╨╗╨╕╤З╨╜╨╛╨╝ ╨║╨░╨▒╨╕╨╜╨╡╤В╨╡</a>.
              </p>
              <SettingsCard>
                <p style={{ fontSize: 13, marginBottom: 10 }}>
                  ╨б╤В╨░╤В╤Г╤Б:{" "}
                  <span style={{ color: cdekStatus?.configured ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                    {cdekStatus?.configured ? "╨Я╨╛╨┤╨║╨╗╤О╤З╨╡╨╜╨╛" : "╨Э╨╡ ╨╜╨░╤Б╤В╤А╨╛╨╡╨╜╨╛"}
                  </span>
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={cdekEnabled} onChange={(e) => setCdekEnabled(e.target.checked)} />
                  ╨Т╨║╨╗╤О╤З╨╕╤В╤М ╨б╨Ф╨н╨Ъ
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" checked={cdekTestMode} onChange={(e) => setCdekTestMode(e.target.checked)} />
                  ╨в╨╡╤Б╤В╨╛╨▓╤Л╨╣ API (api.edu.cdek.ru)
                </label>
                <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
                  <input className="crm-input" placeholder="Account (client_id)" value={cdekClientId} onChange={(e) => setCdekClientId(e.target.value)} />
                  <input className="crm-input" placeholder="Secure password (client_secret)" type="password" value={cdekClientSecret} onChange={(e) => setCdekClientSecret(e.target.value)} />
                  <input className="crm-input" placeholder="╨Ъ╨╛╨┤ ╨Я╨Т╨Ч ╨╛╤В╨┐╤А╨░╨▓╨║╨╕ (╨╜╨░╨┐╤А. MSK1)" value={cdekShipmentPoint} onChange={(e) => setCdekShipmentPoint(e.target.value)} />
                  <input className="crm-input" placeholder="╨Ъ╨╛╨┤ ╨│╨╛╤А╨╛╨┤╨░ ╨╛╤В╨┐╤А╨░╨▓╨╗╨╡╨╜╨╕╤П (╨╜╨░╨┐╤А. 44 тАФ ╨Ь╨╛╤Б╨║╨▓╨░)" value={cdekFromCity} onChange={(e) => setCdekFromCity(e.target.value)} />
                  <input className="crm-input" placeholder="╨в╨░╤А╨╕╤Д ╨┐╨╛ ╤Г╨╝╨╛╨╗╤З╨░╨╜╨╕╤О (136 тАФ ╤Б╨║╨╗╨░╨┤-╤Б╨║╨╗╨░╨┤)" value={cdekTariff} onChange={(e) => setCdekTariff(e.target.value)} />
                </div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
                  ╨Ъ╨╗╤О╤З╨╕ ╨╝╨╛╨╢╨╜╨╛ ╨╖╨░╨┤╨░╤В╤М ╨▓ <code>.env</code>: <code>CDEK_CLIENT_ID</code>, <code>CDEK_CLIENT_SECRET</code>, <code>CDEK_ENABLED=true</code>, <code>CDEK_TEST_MODE=false</code>.
                  ╨Ю╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╨╛: <code>CDEK_SHIPMENT_POINT</code>, <code>CDEK_FROM_CITY_CODE</code> (╨║╨╛╨┤ ╨│╨╛╤А╨╛╨┤╨░ ╨╛╤В╨┐╤А╨░╨▓╨║╨╕).
                </p>
                <button type="button" className="crm-btn" onClick={() => saveCdekMutation.mutate()} disabled={saveCdekMutation.isPending}>
                  ╨б╨╛╤Е╤А╨░╨╜╨╕╤В╤М
                </button>
              </SettingsCard>
            </>
          )}

          {tab === "cdek" && user?.role !== "admin" && (
            <p style={{ color: "var(--text-muted)" }}>╨Э╨░╤Б╤В╤А╨╛╨╣╨║╨░ ╨б╨Ф╨н╨Ъ ╨┤╨╛╤Б╤В╤Г╨┐╨╜╨░ ╤В╨╛╨╗╤М╨║╨╛ ╨░╨┤╨╝╨╕╨╜╨╕╤Б╤В╤А╨░╤В╨╛╤А╤Г</p>
          )}

          {tab === "ai" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>YandexGPT тАФ ╨┐╨╛╨╝╨╛╤Й╨╜╨╕╨║ ╨╛╨┐╨╡╤А╨░╤В╨╛╤А╨░╨╝</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
                ╨Т ╤З╨░╤В╨╡ ╨║╨╜╨╛╨┐╨║╨╕ <strong>тЬи ╨Р╨╗╨╕╤Б╨░</strong>, ┬л╨г╨╗╤Г╤З╤И╨╕╤В╤М ╤В╨╡╨║╤Б╤В┬╗, ┬л╨а╨╡╨╖╤О╨╝╨╡ ╤З╨░╤В╨░┬╗. ╨Ш╤Б╨┐╨╛╨╗╤М╨╖╤Г╨╡╤В╤Б╤П API Yandex Cloud (╨╝╨╛╨┤╨╡╨╗╤М Alice / YandexGPT).
              </p>
              <div className="crm-card" style={{ padding: 16, borderRadius: 12, marginBottom: 16 }}>
                <p style={{ fontSize: 13, marginBottom: 8 }}>
                  ╨б╤В╨░╤В╤Г╤Б:{" "}
                  <span style={{ color: aiStatus?.configured ? "var(--success)" : "var(--danger)", fontWeight: 600 }}>
                    {aiStatus?.configured ? `╨Я╨╛╨┤╨║╨╗╤О╤З╨╡╨╜╨╛ (${aiStatus.model})` : "╨Э╨╡ ╨╜╨░╤Б╤В╤А╨╛╨╡╨╜╨╛"}
                  </span>
                </p>
                {aiStatus?.missing && aiStatus.missing.length > 0 && (
                  <p style={{ fontSize: 12, color: "var(--danger)", marginBottom: 8 }}>
                    ╨Э╨╡ ╤Е╨▓╨░╤В╨░╨╡╤В ╨▓ .env: <strong>{aiStatus.missing.join(", ")}</strong>
                  </p>
                )}
                {!aiStatus?.configured && (
                  <ol style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8, paddingLeft: 18 }}>
                    <li>╨Ч╨░╨╣╨┤╨╕╤В╨╡ ╨▓ <a href="https://console.yandex.cloud" target="_blank" rel="noreferrer">console.yandex.cloud</a></li>
                    <li>╨б╨╛╨╖╨┤╨░╨╣╤В╨╡ ╨║╨░╤В╨░╨╗╨╛╨│ (folder) тЖТ ╤Б╨║╨╛╨┐╨╕╤А╤Г╨╣╤В╨╡ <strong>Folder ID</strong></li>
                    <li>╨б╨╡╤А╨▓╨╕╤Б╨╜╤Л╨╣ ╨░╨║╨║╨░╤Г╨╜╤В тЖТ API-╨║╨╗╤О╤З ╤Б ╨┐╤А╨░╨▓╨╛╨╝ <code>yc.ai.foundationModels.execute</code></li>
                    <li>╨Т ╤Д╨░╨╣╨╗ <code>.env</code> ╨╜╨░ ╤Б╨╡╤А╨▓╨╡╤А╨╡ ╨┤╨╛╨▒╨░╨▓╤М╤В╨╡:</li>
                  </ol>
                )}
                <pre style={{ background: "var(--bg)", padding: 12, borderRadius: 8, fontSize: 11, marginTop: 8, overflow: "auto" }}>
{`YANDEX_API_KEY=╨▓╨░╤И_api_╨║╨╗╤О╤З
YANDEX_FOLDER_ID=╨▓╨░╤И_folder_id
YANDEX_MODEL=yandexgpt-lite`}
                </pre>
                <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
                  ╨Ф╨╗╤П ╨╝╨╛╨┤╨╡╨╗╨╕ ┬л╨Я╤А╨╛┬╗: <code>YANDEX_MODEL=yandexgpt</code>. ╨Я╨╛╤Б╨╗╨╡ ╨╕╨╖╨╝╨╡╨╜╨╡╨╜╨╕╤П .env: <code>pm2 restart crm</code>
                </p>
              </div>
            </>
          )}

          {tab === "sales" && user?.role === "admin" && (             <>               <SalesSettingsSection />             </>           )}            {tab === "channels" && (
            <>
              <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>╨Ъ╨░╨╜╨░╨╗╤Л ╨╕ ╨╝╨╡╤Б╤Б╨╡╨╜╨┤╨╢╨╡╤А╤Л</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 16, lineHeight: 1.6 }}>
                ╨Я╨╛╨┤╨║╨╗╤О╤З╨╕╤В╨╡ Telegram, ╨Р╨▓╨╕╤В╨╛, WhatsApp, VK. ╨Т╤Е╨╛╨┤╤П╤Й╨╕╨╡ ╤Б╨╛╨╛╨▒╤Й╨╡╨╜╨╕╤П ╨┐╤А╨╕╤Е╨╛╨┤╤П╤В ╨┐╨╛ webhook.
                ╨Ф╨╗╤П ╨Р╨▓╨╕╤В╨╛ ╨╜╤Г╨╢╨╡╨╜ ╨┐╤Г╨▒╨╗╨╕╤З╨╜╤Л╨╣ HTTPS-╨░╨┤╤А╨╡╤Б (╤Г╨║╨░╨╢╨╕╤В╨╡ PUBLIC_URL ╨▓ .env).
              </p>
              {user?.role === "admin" && (
                <SettingsCard>
                  <p style={{ fontSize: 13, fontWeight: 600, marginBottom: 12 }}>╨Ф╨╛╨▒╨░╨▓╨╕╤В╤М ╨║╨░╨╜╨░╨╗</p>
                  <div style={{ display: "grid", gap: 10, maxWidth: 560 }}>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <input className="crm-input" placeholder="╨Э╨░╨╖╨▓╨░╨╜╨╕╨╡" value={newChannelName} onChange={e => setNewChannelName(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
                      <select className="crm-input" value={newChannelType} onChange={e => setNewChannelType(e.target.value)} style={{ width: 140 }}>
                        <option value="telegram">Telegram</option>
                        <option value="avito">╨Р╨▓╨╕╤В╨╛</option>
                        <option value="whatsapp">WhatsApp</option>
                        <option value="vk">╨Т╨Ъ╨╛╨╜╤В╨░╨║╤В╨╡</option>
                        <option value="instagram">Instagram</option>
                        <option value="manual">╨Т╤А╤Г╤З╨╜╤Г╤О</option>
                      </select>
                    </div>
                    {newChannelType === "telegram" && (
                      <input className="crm-input" placeholder="Bot Token ╨╛╤В @BotFather" value={chBotToken} onChange={e => setChBotToken(e.target.value)} />
                    )}
                    {newChannelType === "avito" && (
                      <>
                        <input className="crm-input" placeholder="Client ID (developers.avito.ru)" value={chClientId} onChange={e => setChClientId(e.target.value)} />
                        <input className="crm-input" placeholder="Client Secret" type="password" value={chClientSecret} onChange={e => setChClientSecret(e.target.value)} />
                        <input className="crm-input" placeholder="User ID ╨░╨║╨║╨░╤Г╨╜╤В╨░ ╨Р╨▓╨╕╤В╨╛" value={chUserId} onChange={e => setChUserId(e.target.value)} />
                        <input className="crm-input" placeholder="Webhook Secret (╨╛╨┐╤Ж╨╕╨╛╨╜╨░╨╗╤М╨╜╨╛)" value={chWebhookSecret} onChange={e => setChWebhookSecret(e.target.value)} />
                      </>
                    )}
                    {newChannelType === "whatsapp" && (
                      <>
                        <input className="crm-input" placeholder="Phone Number ID" value={chPhoneNumberId} onChange={e => setChPhoneNumberId(e.target.value)} />
                        <input className="crm-input" placeholder="WhatsApp Access Token" type="password" value={chWhatsappToken} onChange={e => setChWhatsappToken(e.target.value)} />
                        <input className="crm-input" placeholder="Verify Token (╨┤╨╗╤П ╨┐╨╛╨┤╤В╨▓╨╡╤А╨╢╨┤╨╡╨╜╨╕╤П webhook)" value={chVerifyToken} onChange={e => setChVerifyToken(e.target.value)} />
                      </>
                    )}
                    {newChannelType === "vk" && (
                      <>
                        <input className="crm-input" placeholder="╨в╨╛╨║╨╡╨╜ ╤Б╨╛╨╛╨▒╤Й╨╡╤Б╤В╨▓╨░ VK" type="password" value={chVkToken} onChange={e => setChVkToken(e.target.value)} />
                        <input className="crm-input" placeholder="Secret ╨┤╨╗╤П Callback API" value={chWebhookSecret} onChange={e => setChWebhookSecret(e.target.value)} />
                      </>
                    )}
                    {channelError && <p style={{ color: "var(--danger)", fontSize: 12 }}>{channelError}</p>}
                    <button type="button" className="crm-btn" onClick={() => newChannelName && createChannelMutation.mutate()} disabled={createChannelMutation.isPending} style={{ height: 36, width: "fit-content" }}>
                      {createChannelMutation.isPending ? "╨Я╨╛╨┤╨║╨╗╤О╤З╨╡╨╜╨╕╨╡..." : "+ ╨Я╨╛╨┤╨║╨╗╤О╤З╨╕╤В╤М ╨║╨░╨╜╨░╨╗"}
                    </button>
                  </div>
                </SettingsCard>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {channels.map((ch: any) => {
                  const webhookUrl = ch.webhookUrl || `${window.location.origin}/api/webhooks/${ch.type}/${ch.slug || ch.id}`;
                  const icons: Record<string, string> = { telegram: "тЬИя╕П", avito: "ЁЯПа", whatsapp: "ЁЯУ▒", vk: "ЁЯФ╡", instagram: "ЁЯУ╕", manual: "тЬПя╕П" };
                  return (
                    <div key={ch.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, padding: 16 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                        <span style={{ fontSize: 20 }}>{icons[ch.type] || "ЁЯУб"}</span>
                        <div style={{ flex: 1 }}>
                          <p style={{ fontWeight: 600, fontSize: 13 }}>{ch.name}</p>
                          <p style={{ fontSize: 11, color: "var(--text-muted)" }}>{ch.type} ┬╖ {ch.slug}</p>
                        </div>
                        {user?.role === "admin" && (
                          <button type="button" className="crm-btn crm-btn-ghost" style={{ height: 28, fontSize: 11 }} onClick={() => testChannelMutation.mutate(ch.id)}>
                            ╨Я╤А╨╛╨▓╨╡╤А╨╕╤В╤М
                          </button>
                        )}
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: ch.isActive ? "var(--success)" : "var(--text-muted)" }} />
                        {user?.role === "admin" && (
                          <button type="button" onClick={() => deleteChannelMutation.mutate(ch.id)} style={{ background: "none", border: "none", color: "var(--danger)", cursor: "pointer", fontSize: 16 }}>ЁЯЧС</button>
                        )}
                      </div>
                      {ch.setupHint && <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>{ch.setupHint}</p>}
                      <div style={{ background: "var(--bg)", borderRadius: 6, padding: "8px 12px", fontSize: 11, fontFamily: "monospace", color: "var(--accent)", wordBreak: "break-all" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: 10, display: "block", marginBottom: 2 }}>Webhook URL (╨▓╤Б╤В╨░╨▓╤М╤В╨╡ ╨▓ ╨Р╨▓╨╕╤В╨╛ / Meta / VK):</span>
                        {webhookUrl}
                      </div>
                    </div>
                  );
                })}
                {channels.length === 0 && <p style={{ color: "var(--text-muted)", fontSize: 13 }}>╨Ъ╨░╨╜╨░╨╗╤Л ╨╜╨╡ ╨┤╨╛╨▒╨░╨▓╨╗╨╡╨╜╤Л. ╨Ф╨╛╨▒╨░╨▓╤М╤В╨╡ ╨Р╨▓╨╕╤В╨╛ ╨╕╨╗╨╕ Telegram ╨▓╤Л╤И╨╡.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </AppShell>
  );
}
