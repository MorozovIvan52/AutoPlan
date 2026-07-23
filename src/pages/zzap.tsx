import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/fetch-api";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../lib/auth";
import { useToast } from "../lib/toast";

type PriceList = {
  id: number;
  name: string;
  codeTemplate: number;
  fileName: string | null;
  storedFileName: string | null;
  enabled: boolean;
  lastUploadedAt: string | null;
  lastUploadError: string | null;
  publicUrl?: string | null;
  templateKind?: "exchange" | "sale";
  cabinetName?: string | null;
  searchHint?: string | null;
};

function formatDt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function ZzapPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdmin = user?.role === "admin";

  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [autoUpload, setAutoUpload] = useState(true);
  const [uploadHour, setUploadHour] = useState("9");
  const [uploadMinute, setUploadMinute] = useState("0");

  const [newName, setNewName] = useState("");
  const [newCode, setNewCode] = useState("");
  const fileRefs = useRef<Record<number, HTMLInputElement | null>>({});

  const { data: status } = useQuery({
    queryKey: ["zzap-status"],
    queryFn: () => apiFetch<any>("/api/zzap/status"),
    refetchInterval: 30000,
  });

  const { data: settingsData } = useQuery({
    queryKey: ["zzap-settings"],
    queryFn: () => apiFetch<{ settings: any }>("/api/zzap/settings"),
    enabled: isAdmin,
  });

  const { data: listsData, isLoading } = useQuery({
    queryKey: ["zzap-lists"],
    queryFn: () => apiFetch<{ lists: PriceList[] }>("/api/zzap/lists"),
  });

  useEffect(() => {
    const s = settingsData?.settings;
    if (!s) return;
    setLogin(s.login || "");
    setPassword(s.password || "");
    setApiKey(s.apiKey || "");
    setEnabled(!!s.enabled);
    setAutoUpload(s.autoUploadEnabled !== false);
    setUploadHour(String(s.uploadHour ?? 9));
    setUploadMinute(String(s.uploadMinute ?? 0));
  }, [settingsData?.settings]);

  const saveSettings = useMutation({
    mutationFn: () => apiFetch("/api/zzap/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enabled,
        login: login.trim(),
        password,
        apiKey,
        autoUploadEnabled: autoUpload,
        uploadHour: parseInt(uploadHour) || 9,
        uploadMinute: parseInt(uploadMinute) || 0,
      }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zzap-settings"] });
      qc.invalidateQueries({ queryKey: ["zzap-status"] });
      toast("Настройки ZZap сохранены", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const createList = useMutation({
    mutationFn: () => apiFetch("/api/zzap/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), codeTemplate: parseInt(newCode) }),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zzap-lists"] });
      setNewName("");
      setNewCode("");
      toast("Прайс добавлен — загрузите файл", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const uploadAll = useMutation({
    mutationFn: () => apiFetch<{ uploaded: number; failed: number; errors: string[] }>("/api/zzap/upload-all", { method: "POST" }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["zzap-lists"] });
      qc.invalidateQueries({ queryKey: ["zzap-status"] });
      if (r.failed === 0) toast(`Все прайсы загружены (${r.uploaded})`, "success");
      else toast(`Загружено: ${r.uploaded}, ошибок: ${r.failed}`, "info");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const uploadOne = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/zzap/lists/${id}/upload`, { method: "POST" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zzap-lists"] });
      qc.invalidateQueries({ queryKey: ["zzap-status"] });
      toast("Прайс отправлен на ZZap", "success");
    },
    onError: (e: Error) => toast(e.message, "error"),
  });

  const toggleList = useMutation({
    mutationFn: ({ id, enabled: en }: { id: number; enabled: boolean }) => apiFetch(`/api/zzap/lists/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: en }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["zzap-lists"] }),
  });

  const deleteList = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/zzap/lists/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["zzap-lists"] });
      toast("Удалено", "info");
    },
  });

  async function uploadFile(listId: number, file: File, uploadNow: boolean) {
    const fd = new FormData();
    fd.append("file", file);
    if (uploadNow) fd.append("uploadNow", "1");
    const res = await fetch(`/api/zzap/lists/${listId}/file`, { method: "POST", body: fd, credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Ошибка загрузки файла");
    qc.invalidateQueries({ queryKey: ["zzap-lists"] });
    if (data.upload?.ok === false) toast(data.upload.error || "Файл сохранён, но ZZap вернул ошибку", "info");
    else if (uploadNow) toast("Файл сохранён и отправлен на ZZap", "success");
    else toast("Файл сохранён", "success");
  }

  const lists = listsData?.lists || [];

  return (
    <AppShell hideTopBar>
      <div className="page-header">
        <h1 className="page-title">🔧 ZZap — прайсы</h1>
        {isAdmin && (
          <button type="button" className="crm-btn" onClick={() => uploadAll.mutate()} disabled={uploadAll.isPending}>
            {uploadAll.isPending ? "Загрузка…" : "↑ Загрузить все сейчас"}
          </button>
        )}
      </div>

      <div className="page-body" style={{ maxWidth: 960 }}>
        <div className="crm-card" style={{ padding: 16, marginBottom: 16, border: "1px solid var(--danger)", background: "rgba(220,53,69,0.08)" }}>
          <p style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
            Частая ошибка: в ZZap нельзя ставить URL <code>https://crmavito.online/zzap</code> — это страница CRM (HTML).
            В логах ZZap всё ещё качает <code>/zzap</code> — проверьте <strong>все 4</strong> шаблона.
            В ZZap вставляйте ссылку с <strong>кодом шаблона</strong> (<code>/template/350016971/price.xlsx</code>), не <code>/files/2/</code> — id в CRM меняется.
          </p>
        </div>

        <div className="crm-card" style={{ padding: 16, marginBottom: 16 }}>
          <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
            CRM обновляет файлы на сервере <strong>каждые 3 часа</strong> (как ZZap «Каждые 3 часа»).
            ZZap забирает их по <strong>внешней ссылке</strong> (ключ <code>zzap1_…</code>).
            После обновления в CRM нажмите <strong>«Обновить»</strong> в шаблоне ZZap или дождитесь следующего цикла.
          </p>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12 }}>
            <span>Статус: <strong>{status?.configured ? "настроен" : "не настроен"}</strong></span>
            <span>Авто: <strong>{status?.autoUploadEnabled ? "вкл (каждые 3ч)" : "выкл"}</strong></span>
            <span>Последний запуск: <strong>{formatDt(status?.lastRunAt)}</strong></span>
          </div>
          {status?.lastRunError && (
            <p style={{ fontSize: 12, color: "var(--danger)", marginTop: 8 }}>{status.lastRunError}</p>
          )}
        </div>

        {isAdmin && (
          <div className="crm-card" style={{ padding: 16, marginBottom: 16 }}>
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Подключение ZZap API</h3>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12, lineHeight: 1.5 }}>
              <p style={{ marginBottom: 8 }}>
                <strong style={{ color: "var(--success)" }}>Ключ <code>zzap1_…</code> — рабочий.</strong> Старый API загрузки прайсов его не принимает,
                поэтому CRM работает в режиме <strong>«внешняя ссылка»</strong>: файлы лежат на сервере CRM, ZZap забирает их сам.
              </p>
              <p style={{ marginBottom: 8 }}>
                <strong>Один раз в ZZap</strong> для каждого шаблона: тип загрузки → <strong>«Внешняя ссылка»</strong> → URL из таблицы ниже.
                Периодичность — <strong>«Каждые 3 часа»</strong> (не «Никогда»).
              </p>
              <p style={{ marginBottom: 8 }}>
                <strong>Поиск «Любая» vs «б/у»:</strong> <strong>Обмен</strong> — в «Любая» (цена при обмене).
                <strong> Продажа</strong> — в «б/у», если в шаблоне ZZap включено «б/у и уценка».
                Чтобы продажа 58 490 ₽ была в «Любая» — снимите «б/у и уценка» в шаблоне ПРОДАЖА в кабинете ZZap.
              </p>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 13 }}>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              Интеграция включена
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <input className="crm-input" placeholder="Email (login)" value={login} onChange={(e) => setLogin(e.target.value)} />
              <input className="crm-input" placeholder="Пароль" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <input className="crm-input" placeholder="API-ключ для загрузки прайсов (из «Для партнеров»)" value={apiKey} onChange={(e) => setApiKey(e.target.value)} style={{ gridColumn: "1 / -1" }} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, fontSize: 13 }}>
              <input type="checkbox" checked={autoUpload} onChange={(e) => setAutoUpload(e.target.checked)} />
              Автообновление файлов каждые 3 часа
            </label>
            <button type="button" className="crm-btn" onClick={() => saveSettings.mutate()} disabled={saveSettings.isPending}>
              Сохранить настройки
            </button>
          </div>
        )}

        {isAdmin && (
          <div className="crm-card" style={{ padding: 16, marginBottom: 16 }}>
            <h3 style={{ marginBottom: 12, fontSize: 15 }}>Добавить прайс</h3>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input className="crm-input" placeholder="Название (Акцепт-прайс)" value={newName} onChange={(e) => setNewName(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
              <input className="crm-input" placeholder="Код шаблона ZZap" value={newCode} onChange={(e) => setNewCode(e.target.value)} style={{ width: 160 }} />
              <button type="button" className="crm-btn" onClick={() => createList.mutate()} disabled={!newName.trim() || !newCode.trim() || createList.isPending}>
                + Добавить
              </button>
            </div>
          </div>
        )}

        <div className="crm-card" style={{ padding: 0, overflow: "hidden" }}>
          {isLoading ? (
            <p style={{ padding: 16, color: "var(--text-muted)" }}>Загрузка…</p>
          ) : lists.length === 0 ? (
            <p style={{ padding: 16, color: "var(--text-muted)" }}>
              Прайсов пока нет. Добавьте 4 прайса (Акцепт-прайс, Акцепт-разбор, Продажа-прайс, Продажа-разборки) и загрузите .xlsx файлы.
            </p>
          ) : (
            <table className="data-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Название</th>
                  <th>Шаблон</th>
                  <th>Файл / ссылка</th>
                  <th>Последняя загрузка</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lists.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{l.name}</div>
                      {l.cabinetName && (
                        <div style={{ fontSize: 11, color: "var(--primary)", marginTop: 2 }}>
                          ZZap: {l.cabinetName}
                        </div>
                      )}
                      {l.searchHint && (
                        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4, maxWidth: 200, lineHeight: 1.35 }}>
                          {l.searchHint}
                        </div>
                      )}
                      {isAdmin && (
                        <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                          <input type="checkbox" checked={l.enabled} onChange={(e) => toggleList.mutate({ id: l.id, enabled: e.target.checked })} />
                          в авто-загрузке
                        </label>
                      )}
                    </td>
                    <td style={{ fontFamily: "monospace" }}>{l.codeTemplate}</td>
                    <td style={{ fontSize: 12, maxWidth: 220 }}>
                      <div>{l.fileName || <span style={{ color: "var(--text-muted)" }}>не загружен</span>}</div>
                      {l.publicUrl && (
                        <>
                          <div style={{ fontSize: 9, wordBreak: "break-all", color: "var(--text-muted)", marginTop: 4, fontFamily: "monospace" }}>
                            {l.publicUrl}
                          </div>
                          <button
                            type="button"
                            className="crm-btn crm-btn-sm"
                            style={{ marginTop: 4, fontSize: 10 }}
                            onClick={() => { navigator.clipboard.writeText(l.publicUrl!); toast("Ссылка скопирована — вставьте в ZZap", "success"); }}
                            title={l.publicUrl}
                          >
                            📋 Копировать для ZZap
                          </button>
                        </>
                      )}
                    </td>
                    <td style={{ fontSize: 12 }}>
                      <div>{formatDt(l.lastUploadedAt)}</div>
                      {l.lastUploadError && <div style={{ color: "var(--danger)" }}>{l.lastUploadError}</div>}
                    </td>
                    <td>
                      {isAdmin && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <input
                            ref={(el) => { fileRefs.current[l.id] = el; }}
                            type="file"
                            accept=".xls,.xlsx,.xltx,.csv,.txt,.zip"
                            style={{ display: "none" }}
                            onChange={async (e) => {
                              const f = e.target.files?.[0];
                              if (!f) return;
                              try {
                                await uploadFile(l.id, f, true);
                              } catch (err: any) {
                                toast(err.message, "error");
                              }
                              e.target.value = "";
                            }}
                          />
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => fileRefs.current[l.id]?.click()}>
                            📁 Файл
                          </button>
                          <button
                            type="button"
                            className="crm-btn crm-btn-sm"
                            disabled={!l.storedFileName || uploadOne.isPending}
                            onClick={() => uploadOne.mutate(l.id)}
                          >
                            ↑ ZZap
                          </button>
                          <button type="button" className="crm-btn crm-btn-ghost crm-btn-sm" onClick={() => deleteList.mutate(l.id)}>✕</button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </AppShell>
  );
}
