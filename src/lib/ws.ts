import { useEffect, useRef } from "react";

type WSMessage = { type: string; [key: string]: unknown };
type Handler = (msg: WSMessage) => void;

/**
 * Один общий WebSocket на вкладку — иначе GlobalWsListener + Inbox + IncomingCall
 * открывают 3 сокета и при remount устраивают шторм реконнектов (десятки тысяч ошибок).
 */
let shared: WebSocket | null = null;
let sharedUrl = "";
const handlers = new Set<Handler>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;
let reconnectAttempt = 0;
let intentionalClose = false;

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingTimer) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function wsUrl(): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws`;
}

function dispatch(msg: WSMessage) {
  for (const h of handlers) {
    try {
      h(msg);
    } catch {
      /* ignore handler errors */
    }
  }
}

function scheduleReconnect() {
  if (intentionalClose || handlers.size === 0) return;
  if (reconnectTimer) return;
  const delay = Math.min(30_000, 1000 * 2 ** Math.min(reconnectAttempt, 5));
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureSocket();
  }, delay);
}

function ensureSocket() {
  if (typeof window === "undefined") return;
  if (handlers.size === 0) return;
  if (
    shared &&
    (shared.readyState === WebSocket.OPEN || shared.readyState === WebSocket.CONNECTING) &&
    sharedUrl === wsUrl()
  ) {
    return;
  }

  intentionalClose = false;
  try {
    shared?.close();
  } catch {
    /* ignore */
  }
  shared = null;

  const url = wsUrl();
  sharedUrl = url;
  const ws = new WebSocket(url);
  shared = ws;

  ws.onmessage = (e) => {
    try {
      dispatch(JSON.parse(String(e.data)) as WSMessage);
    } catch {
      /* ignore malformed */
    }
  };

  ws.onopen = () => {
    reconnectAttempt = 0;
    if (pingTimer) clearInterval(pingTimer);
    pingTimer = setInterval(() => {
      if (shared?.readyState === WebSocket.OPEN) shared.send("ping");
    }, 20_000);
  };

  ws.onclose = () => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    if (shared === ws) shared = null;
    scheduleReconnect();
  };

  ws.onerror = () => {
    /* onclose follow-up */
  };
}

function releaseSocketIfIdle() {
  if (handlers.size > 0) return;
  intentionalClose = true;
  clearTimers();
  try {
    shared?.close();
  } catch {
    /* ignore */
  }
  shared = null;
}

export function useWebSocket(onMessage: Handler) {
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  useEffect(() => {
    const stable: Handler = (msg) => handlerRef.current(msg);
    handlers.add(stable);
    ensureSocket();
    return () => {
      handlers.delete(stable);
      releaseSocketIfIdle();
    };
  }, []);
}
