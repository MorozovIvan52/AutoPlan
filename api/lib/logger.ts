/**
 * Структурированные JSON-логи (паттерн hono-pino / pino) без тяжёлой зависимости.
 * PM2: каждая строка — JSON с requestId, tenantId, userId.
 */
type Level = "debug" | "info" | "warn" | "error";

export type LogBindings = Record<string, unknown>;

function levelNum(level: Level): number {
  switch (level) {
    case "debug": return 20;
    case "info": return 30;
    case "warn": return 40;
    case "error": return 50;
  }
}

const minLevel = (): number => {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  if (raw === "debug") return 20;
  if (raw === "warn") return 40;
  if (raw === "error") return 50;
  return 30;
};

function write(level: Level, bindings: LogBindings, msg: string) {
  if (levelNum(level) < minLevel()) return;
  const line = JSON.stringify({
    level: levelNum(level),
    time: new Date().toISOString(),
    msg,
    ...bindings,
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  debug: (b: LogBindings, msg: string) => write("debug", b, msg),
  info: (b: LogBindings, msg: string) => write("info", b, msg),
  warn: (b: LogBindings, msg: string) => write("warn", b, msg),
  error: (b: LogBindings, msg: string) => write("error", b, msg),
  child(base: LogBindings) {
    return {
      debug: (b: LogBindings, msg: string) => write("debug", { ...base, ...b }, msg),
      info: (b: LogBindings, msg: string) => write("info", { ...base, ...b }, msg),
      warn: (b: LogBindings, msg: string) => write("warn", { ...base, ...b }, msg),
      error: (b: LogBindings, msg: string) => write("error", { ...base, ...b }, msg),
    };
  },
};
