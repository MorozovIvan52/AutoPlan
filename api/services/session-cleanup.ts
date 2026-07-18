import { cleanupExpiredSessions } from "../lib/session";

const INTERVAL_MS = 60 * 60 * 1000;

export function startSessionCleanup() {
  const run = async () => {
    try {
      const n = await cleanupExpiredSessions();
      if (n > 0) console.log(`[sessions] удалено просроченных: ${n}`);
    } catch (e: any) {
      console.warn("[sessions] cleanup:", e.message);
    }
  };
  void run();
  return setInterval(run, INTERVAL_MS);
}
