import { readFileSync, existsSync } from "node:fs";

/** Загружает .env, не перезаписывая уже заданные переменные (как dotenv). */
if (existsSync(".env")) {
  for (const line of readFileSync(".env", "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^([^=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = m[2].trim().replace(/^["']|["']$/g, "");
  }
}
