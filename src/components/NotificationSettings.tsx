import { useState, useEffect } from "react";
import {
  getAlertPrefs,
  saveAlertPrefs,
  requestBrowserNotificationPermission,
  type AlertPrefs,
} from "../lib/notification-alerts";
import { useToast } from "../lib/toast";

export function NotificationSettings() {
  const { toast } = useToast();
  const [prefs, setPrefs] = useState<AlertPrefs>(getAlertPrefs);
  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== "undefined" ? Notification.permission : "denied",
  );

  useEffect(() => setPrefs(getAlertPrefs()), []);

  const update = (partial: Partial<AlertPrefs>) => {
    const next = saveAlertPrefs(partial);
    setPrefs(next);
  };

  const enableBrowser = async () => {
    const p = await requestBrowserNotificationPermission();
    setPerm(p);
    if (p === "granted") {
      update({ browserEnabled: true });
      toast("Браузерные уведомления включены", "success");
    } else if (p === "denied") {
      toast("Разрешите уведомления в настройках браузера", "error");
    }
  };

  return (
    <div style={{ maxWidth: 520 }}>
      <h3 style={{ fontFamily: "Poppins", fontSize: 16, fontWeight: 600, marginBottom: 8 }}>Звук и оповещения</h3>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16, lineHeight: 1.5 }}>
        Настройте звуковые сигналы при новых сообщениях и задачах. На телефоне добавьте сайт на главный экран — так удобнее работать.
      </p>

      <div className="crm-card" style={{ padding: 16, borderRadius: 12, marginBottom: 12 }}>
        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>🔊 Звук</p>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={prefs.soundEnabled} onChange={(e) => update({ soundEnabled: e.target.checked })} />
          Включить звук
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer", marginLeft: 16 }}>
          <input type="checkbox" checked={prefs.soundMessages} disabled={!prefs.soundEnabled} onChange={(e) => update({ soundMessages: e.target.checked })} />
          Новые сообщения от клиентов
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginLeft: 16 }}>
          <input type="checkbox" checked={prefs.soundTasks} disabled={!prefs.soundEnabled} onChange={(e) => update({ soundTasks: e.target.checked })} />
          Задачи и напоминания
        </label>
      </div>

      <div className="crm-card" style={{ padding: 16, borderRadius: 12, marginBottom: 12 }}>
        <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>🔔 Браузерные уведомления</p>
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
          Показываются, когда вкладка CRM в фоне. Статус: <strong>{perm === "granted" ? "разрешено" : perm === "denied" ? "запрещено" : "не запрошено"}</strong>
        </p>
        {perm !== "granted" && (
          <button type="button" className="crm-btn crm-btn-sm" style={{ marginBottom: 10 }} onClick={enableBrowser}>
            Разрешить уведомления
          </button>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={prefs.browserEnabled} disabled={perm !== "granted"} onChange={(e) => update({ browserEnabled: e.target.checked })} />
          Показывать всплывающие уведомления
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, marginBottom: 8, cursor: "pointer", marginLeft: 16 }}>
          <input type="checkbox" checked={prefs.browserMessages} disabled={!prefs.browserEnabled} onChange={(e) => update({ browserMessages: e.target.checked })} />
          Сообщения клиентов
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer", marginLeft: 16 }}>
          <input type="checkbox" checked={prefs.browserTasks} disabled={!prefs.browserEnabled} onChange={(e) => update({ browserTasks: e.target.checked })} />
          Задачи
        </label>
      </div>

      <div className="crm-card" style={{ padding: 16, borderRadius: 12 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
          <input type="checkbox" checked={prefs.vibration} onChange={(e) => update({ vibration: e.target.checked })} />
          Вибрация на телефоне
        </label>
      </div>
    </div>
  );
}
