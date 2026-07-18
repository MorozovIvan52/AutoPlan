import { useEffect, useRef, useCallback } from "react";

type WSMessage = { type: string; [key: string]: unknown };

export function useWebSocket(onMessage: (msg: WSMessage) => void) {
  const ws = useRef<WebSocket | null>(null);
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const connect = useCallback(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/api/ws`;
    ws.current = new WebSocket(url);

    ws.current.onmessage = (e) => {
      try {
        onMessage(JSON.parse(e.data));
      } catch {
        /* ignore malformed frames */
      }
    };
    ws.current.onclose = () => {
      setTimeout(connect, 3000);
    };
    ws.current.onopen = () => {
      pingInterval.current = setInterval(() => {
        if (ws.current?.readyState === WebSocket.OPEN) ws.current.send("ping");
      }, 20000);
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      ws.current?.close();
      if (pingInterval.current) clearInterval(pingInterval.current);
    };
  }, [connect]);
}
