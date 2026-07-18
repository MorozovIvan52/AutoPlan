export type WsClient = {
  send: (data: string) => void;
  userId: number;
};

export const wsClients = new Set<WsClient>();

export function broadcast(data: object) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    try {
      ws.send(msg);
    } catch {
      /* ignore */
    }
  }
}

export function broadcastToUser(userId: number, data: object) {
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (ws.userId !== userId) continue;
    try {
      ws.send(msg);
    } catch {
      /* ignore */
    }
  }
}

export function broadcastToUsers(userIds: number[], data: object) {
  const allowed = new Set(userIds);
  if (!allowed.size) return;
  const msg = JSON.stringify(data);
  for (const ws of wsClients) {
    if (!allowed.has(ws.userId)) continue;
    try {
      ws.send(msg);
    } catch {
      /* ignore */
    }
  }
}
