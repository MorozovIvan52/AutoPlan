import { getZzapSettings, uploadAllZzapPriceLists } from "../lib/zzap";
import { warnIfZzapPublicUrlsBroken } from "../lib/zzap-public";

const CHECK_MS = 5 * 60 * 1000;
const REFRESH_HOURS = 3;

let timer: ReturnType<typeof setInterval> | null = null;
let lastRefreshSlot = "";

function moscowSlot() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(new Date())
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parseInt(parts.hour, 10);
  const slot = `${date}-${Math.floor(hour / REFRESH_HOURS)}`;
  return { date, hour, slot };
}

async function tick() {
  try {
    const settings = await getZzapSettings();
    if (!settings.autoUploadEnabled || !settings.enabled) return;

    const { slot } = moscowSlot();
    if (lastRefreshSlot === slot) return;
    lastRefreshSlot = slot;

    console.log(`[zzap-upload] обновление прайсов (каждые ${REFRESH_HOURS}ч, слот ${slot})`);
    const result = await uploadAllZzapPriceLists();
    console.log(`[zzap-upload] готово: ${result.uploaded} ок, ${result.failed} ошибок`);
    if (result.errors.length) console.warn("[zzap-upload]", result.errors.join(" | "));
  } catch (e: any) {
    console.error("[zzap-upload] ошибка:", e.message);
  }
}

export function startZzapUploadScheduler() {
  if (timer) return;
  if (process.env.ZZAP_UPLOAD_ENABLED === "false") {
    console.log("[zzap-upload] отключён (ZZAP_UPLOAD_ENABLED=false)");
    return;
  }
  void warnIfZzapPublicUrlsBroken();
  timer = setInterval(tick, CHECK_MS);
  console.log(`[zzap-upload] планировщик: обновление файлов каждые ${REFRESH_HOURS} часа (как ZZap)`);
}
