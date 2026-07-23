export type AlertPrefs = {
  soundEnabled: boolean;
  soundMessages: boolean;
  soundTasks: boolean;
  browserEnabled: boolean;
  browserMessages: boolean;
  browserTasks: boolean;
  vibration: boolean;
};

const STORAGE_KEY = "crm-alert-prefs";

const DEFAULT_PREFS: AlertPrefs = {
  soundEnabled: true,
  soundMessages: true,
  soundTasks: true,
  browserEnabled: true,
  browserMessages: true,
  browserTasks: true,
  vibration: true,
};

let activeConversationId: number | null = null;
let audioCtx: AudioContext | null = null;

export function setActiveConversationId(id: number | null) {
  activeConversationId = id;
}

export function getAlertPrefs(): AlertPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveAlertPrefs(partial: Partial<AlertPrefs>) {
  const next = { ...getAlertPrefs(), ...partial };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === "suspended") void audioCtx.resume();
  return audioCtx;
}

export function unlockAudioOnGesture() {
  if (typeof window === "undefined") return;
  const unlock = () => {
    getAudioContext();
    document.removeEventListener("click", unlock);
    document.removeEventListener("touchstart", unlock);
  };
  document.addEventListener("click", unlock, { once: true });
  document.addEventListener("touchstart", unlock, { once: true });
}

function playTone(freq: number, duration: number, volume = 0.15) {
  const ctx = getAudioContext();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.value = volume;
  osc.connect(gain);
  gain.connect(ctx.destination);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.start(now);
  osc.stop(now + duration);
}

export function playMessageSound() {
  const prefs = getAlertPrefs();
  if (!prefs.soundEnabled || !prefs.soundMessages) return;
  playTone(880, 0.12, 0.18);
  window.setTimeout(() => playTone(1100, 0.1, 0.14), 120);
}

export function playTaskSound() {
  const prefs = getAlertPrefs();
  if (!prefs.soundEnabled || !prefs.soundTasks) return;
  playTone(520, 0.18, 0.2);
  window.setTimeout(() => playTone(660, 0.14, 0.16), 160);
}

export function playUrgentSound() {
  const prefs = getAlertPrefs();
  if (!prefs.soundEnabled || !prefs.soundTasks) return;
  playTone(440, 0.22, 0.28);
  window.setTimeout(() => playTone(550, 0.22, 0.28), 220);
  window.setTimeout(() => playTone(700, 0.28, 0.32), 440);
}

function vibrate() {
  const prefs = getAlertPrefs();
  if (!prefs.vibration || !navigator.vibrate) return;
  navigator.vibrate([80, 40, 80]);
}

export async function requestBrowserNotificationPermission(): Promise<NotificationPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) return "denied";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  return Notification.requestPermission();
}

export function showBrowserNotification(title: string, body: string, link?: string, urgent = false) {
  const prefs = getAlertPrefs();
  if (!prefs.browserEnabled) return;
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  if (!urgent && !document.hidden) return;

  try {
    const n = new Notification(title, {
      body,
      icon: "/icon.svg",
      tag: link || title,
      requireInteraction: urgent,
    });
    n.onclick = () => {
      window.focus();
      n.close();
      if (link) window.location.href = link;
    };
  } catch { /* ignore */ }
}

export function alertNewMessage(title: string, body: string, conversationId?: number, link?: string) {
  if (conversationId != null && conversationId === activeConversationId) return;
  const prefs = getAlertPrefs();
  if (prefs.soundMessages) playMessageSound();
  if (prefs.browserMessages) showBrowserNotification(title, body, link);
  vibrate();
}

export function alertTask(title: string, body?: string, link?: string) {
  const prefs = getAlertPrefs();
  if (prefs.soundTasks) playTaskSound();
  if (prefs.browserTasks) showBrowserNotification(title, body || "", link);
  vibrate();
}

export function alertUrgent(title: string, body?: string, link?: string) {
  const prefs = getAlertPrefs();
  if (prefs.soundTasks) playUrgentSound();
  if (prefs.browserTasks) showBrowserNotification(title, body || "", link, true);
  if (navigator.vibrate) navigator.vibrate([120, 60, 120, 60, 200]);
}

export function alertIncomingCall(label: string) {
  const prefs = getAlertPrefs();
  if (prefs.soundTasks) playUrgentSound();
  if (prefs.browserTasks) showBrowserNotification("📞 Входящий звонок", label, undefined, true);
  if (navigator.vibrate) navigator.vibrate([200, 100, 200, 100, 300]);
}

export function handleWsNotification(n: {
  type?: string;
  title?: string;
  text?: string;
  link?: string;
}) {
  const title = n.title || "Уведомление";
  const body = n.text || "";
  const link = n.link;

  if (n.type === "new_message") {
    const convId = link?.match(/conv=(\d+)/)?.[1];
    alertNewMessage(title, body, convId ? parseInt(convId, 10) : undefined, link);
    return;
  }

  if (n.type === "task_due" || n.type === "assigned" || n.type === "mention") {
    alertTask(title, body, link);
    return;
  }

  if (n.type === "avito_advance_empty" || n.type === "avito_advance") {
    alertUrgent(title, body, link);
  }
}
