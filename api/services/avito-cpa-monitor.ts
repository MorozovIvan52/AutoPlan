import { db } from "../database";
import * as schema from "../database/schema";
import { eq, and } from "drizzle-orm";
import { getAvitoAccountWallet, getAvitoCpaBalance } from "../integrations/avito";
import { parseConfig, stringifyConfig } from "../lib/channel-config";
import { getCrmSettings } from "../lib/crm-settings";
import { notifyUser } from "../lib/notify";
import { sendAdvanceAlertTelegram } from "../lib/advance-telegram-alert";

const POLL_MS = 10 * 60 * 1000;
const LOW_NOTIFY_COOLDOWN_MS = 60 * 60 * 1000;
const EMPTY_NOTIFY_COOLDOWN_MS = 30 * 60 * 1000;
/** Ниже этого баланса CPA Авито обычно перестаёт отдавать просмотры */
const EMPTY_CPA_BALANCE_RUB = 120;

let running = false;
let timer: ReturnType<typeof setInterval> | undefined;

/** Баланс CPA из API (как «Аванс» в кабинете Авито). Поле advance в API — другое значение. */
function cpaFundsRub(cpaBalance: number | null, advance: number | null): number {
  if (cpaBalance != null && Number.isFinite(cpaBalance)) return cpaBalance;
  if (advance != null && Number.isFinite(advance)) return advance;
  return 0;
}

function cpaFundsLevel(
  cpaBalance: number | null,
  advance: number | null,
  threshold: number,
): "ok" | "low" | "empty" {
  const funds = cpaFundsRub(cpaBalance, advance);
  if (funds <= EMPTY_CPA_BALANCE_RUB) return "empty";
  if (funds < threshold) return "low";
  return "ok";
}

export type AvitoCpaAccountStatus = {
  channelId: number;
  channelName: string;
  slug: string;
  userId?: string;
  advance: number | null;
  /** Баланс CPA (рекламный кошелёк) */
  cpaBalance: number | null;
  /** Кошелёк аккаунта Авито (real + bonus) */
  wallet: number | null;
  debt: number | null;
  level: "ok" | "low" | "empty" | "error" | "unknown";
  checkedAt?: string;
  error?: string;
};

export type AvitoCpaStatus = {
  configured: boolean;
  accounts: AvitoCpaAccountStatus[];
  threshold: number;
  alertsEnabled: boolean;
  level: "ok" | "low" | "empty" | "unknown";
  checkedAt?: string;
  /** @deprecated use accounts */
  channelName?: string;
  advance?: number;
  balance?: number;
  debt?: number;
  error?: string;
};

function advanceLevel(
  cpaBalance: number | null,
  advance: number | null,
  threshold: number,
): "ok" | "low" | "empty" {
  return cpaFundsLevel(cpaBalance, advance, threshold);
}

function worstLevel(accounts: AvitoCpaAccountStatus[]): AvitoCpaStatus["level"] {
  if (accounts.some((a) => a.level === "empty")) return "empty";
  if (accounts.some((a) => a.level === "low")) return "low";
  if (accounts.length === 0) return "unknown";
  return "ok";
}

function formatRub(n: number): string {
  return n.toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " ₽";
}

async function getAllActiveAvitoChannels() {
  return db.select().from(schema.channels).where(
    and(eq(schema.channels.type, "avito"), eq(schema.channels.isActive, true)),
  );
}

function legacyFields(accounts: AvitoCpaAccountStatus[], threshold: number): Pick<AvitoCpaStatus, "channelName" | "advance" | "balance" | "debt" | "error"> {
  const worst = accounts.find((a) => a.level === "empty")
    || accounts.find((a) => a.level === "low")
    || accounts[0];
  if (!worst) return {};
  return {
    channelName: worst.channelName,
    advance: worst.cpaBalance ?? worst.advance ?? undefined,
    balance: worst.wallet ?? worst.cpaBalance ?? undefined,
    debt: worst.debt ?? undefined,
    error: worst.error,
  };
}

async function pollChannel(
  channel: typeof schema.channels.$inferSelect,
  threshold: number,
  persist = true,
): Promise<AvitoCpaAccountStatus> {
  const config = parseConfig(channel.config);
  const base: AvitoCpaAccountStatus = {
    channelId: channel.id,
    channelName: channel.name,
    slug: channel.slug,
    userId: config.userId,
    advance: config.cpaMonitor?.advance ?? null,
    cpaBalance: config.cpaMonitor?.cpaBalance ?? config.cpaMonitor?.balance ?? null,
    wallet: config.cpaMonitor?.wallet ?? null,
    debt: config.cpaMonitor?.debt ?? null,
    level: "unknown",
    checkedAt: config.cpaMonitor?.checkedAt
      ? new Date(config.cpaMonitor.checkedAt).toISOString()
      : undefined,
  };

  let workingConfig = config;
  const [cpaResult, walletResult] = await Promise.all([
    getAvitoCpaBalance(workingConfig),
    getAvitoAccountWallet(workingConfig),
  ]);
  if (cpaResult.config) workingConfig = cpaResult.config;
  if (walletResult.config) workingConfig = walletResult.config;

  if (!cpaResult.ok || !cpaResult.data) {
    return {
      ...base,
      level: base.cpaBalance != null || base.advance != null
        ? advanceLevel(base.cpaBalance, base.advance, threshold)
        : "error",
      error: cpaResult.error,
    };
  }

  const { advance, balance: cpaBalance, debt } = cpaResult.data;
  const wallet = walletResult.ok ? walletResult.data!.total : null;
  const level = advanceLevel(cpaBalance, advance, threshold);
  const now = Date.now();

  if (persist) {
    const updatedConfig = {
      ...workingConfig,
      cpaMonitor: {
        ...config.cpaMonitor,
        advance,
        cpaBalance,
        wallet,
        balance: cpaBalance,
        debt,
        checkedAt: now,
      },
    };
    await db.update(schema.channels)
      .set({ config: stringifyConfig(updatedConfig) })
      .where(eq(schema.channels.id, channel.id));
  }

  return {
    channelId: channel.id,
    channelName: channel.name,
    slug: channel.slug,
    userId: config.userId,
    advance,
    cpaBalance,
    wallet,
    debt,
    level,
    checkedAt: new Date(now).toISOString(),
    error: walletResult.ok ? undefined : walletResult.error,
  };
}

export async function fetchAvitoCpaStatus(): Promise<AvitoCpaStatus> {
  const settings = await getCrmSettings();
  const threshold = settings.avitoAdvanceThresholdRub ?? 200;
  const alertsEnabled = settings.avitoAdvanceAlertEnabled !== false;
  const channels = await getAllActiveAvitoChannels();

  if (channels.length === 0) {
    return { configured: false, accounts: [], level: "unknown", threshold, alertsEnabled };
  }

  const accounts: AvitoCpaAccountStatus[] = [];
  for (const ch of channels) {
    accounts.push(await pollChannel(ch, threshold, true));
  }

  const level = worstLevel(accounts);
  const latestCheck = accounts
    .map((a) => a.checkedAt)
    .filter(Boolean)
    .sort()
    .pop();

  return {
    configured: true,
    accounts,
    threshold,
    alertsEnabled,
    level,
    checkedAt: latestCheck,
    ...legacyFields(accounts, threshold),
  };
}

async function getAlertRecipients() {
  const active = await db.select().from(schema.users).where(eq(schema.users.isActive, true));
  const admins = active.filter((u) => u.role === "admin");
  const others = active.filter((u) => u.role !== "admin");
  return [...admins, ...others];
}

async function notifyManagers(
  level: "low" | "empty",
  account: AvitoCpaAccountStatus,
  threshold: number,
) {
  const acc = account.channelName;
  const funds = cpaFundsRub(account.cpaBalance, account.advance);
  const fundsStr = formatRub(funds);
  const walletStr = account.wallet != null ? formatRub(account.wallet) : "—";

  const isEmpty = level === "empty";
  const title = isEmpty
    ? `🚨 СРОЧНО: «${acc}» — просмотры остановлены!`
    : `🚨 СРОЧНО: «${acc}» — аванс заканчивается!`;

  const text = isEmpty
    ? [
        `Объявления на Авито не получают просмотры — баланс CPA исчерпан.`,
        `Баланс CPA (аванс): ${fundsStr} · Кошелёк: ${walletStr}`,
        "Менеджеру: срочно пополните аванс в кабинете Авито.",
      ].join("\n")
    : [
        `Скоро закончатся просмотры (как «Вы не получаете просмотры» в Авито).`,
        `Баланс CPA (аванс): ${fundsStr} — ниже порога ${formatRub(threshold)}.`,
        `Кошелёк: ${walletStr}`,
        "Менеджеру: пополните аванс CPA, пока просмотры не остановились.",
      ].join("\n");

  const settings = await getCrmSettings();
  const recipients = await getAlertRecipients();
  for (const user of recipients) {
    await notifyUser({
      userId: user.id,
      type: "avito_advance_empty",
      title,
      text,
      link: "/dashboard",
    });
  }

  const tgOk = await sendAdvanceAlertTelegram(title, text, settings.advanceAlertTelegramChatId);
  console.log(
    `[avito-cpa] СРОЧНО (${level}) → CRM: ${recipients.length} чел., Telegram: ${tgOk ? "да" : "нет"}, ${acc}: баланс CPA ${funds} ₽`,
  );
}

async function checkChannelAlerts(
  channel: typeof schema.channels.$inferSelect,
  threshold: number,
  alertsEnabled: boolean,
  forceNotify: boolean,
): Promise<AvitoCpaAccountStatus> {
  const [freshChannel] = await db.select().from(schema.channels).where(eq(schema.channels.id, channel.id));
  const configBefore = parseConfig(freshChannel?.config);
  const prev = configBefore.cpaMonitor || {};
  const prevLevel = prev.lastLevel || "ok";

  const account = await pollChannel(channel, threshold, true);
  const now = Date.now();
  const [afterPoll] = await db.select().from(schema.channels).where(eq(schema.channels.id, channel.id));
  const config = parseConfig(afterPoll?.config);

  if (account.level === "error") {
    console.warn(`[avito-cpa] ${channel.name}:`, account.error);
    return account;
  }

  let lowNotifiedAt = prev.lowNotifiedAt;
  let emptyNotifiedAt = prev.emptyNotifiedAt;

  if (alertsEnabled || forceNotify) {
    const shouldNotifyEmpty = account.level === "empty" && (
      forceNotify
      || prevLevel !== "empty"
      || !emptyNotifiedAt
      || now - emptyNotifiedAt > EMPTY_NOTIFY_COOLDOWN_MS
    );

    const shouldNotifyLow = account.level === "low" && (
      forceNotify
      || prevLevel === "ok"
      || prevLevel === "empty"
      || !lowNotifiedAt
      || now - lowNotifiedAt > LOW_NOTIFY_COOLDOWN_MS
    );

    if (shouldNotifyEmpty) {
      await notifyManagers("empty", account, threshold);
      emptyNotifiedAt = now;
    } else if (shouldNotifyLow) {
      await notifyManagers("low", account, threshold);
      lowNotifiedAt = now;
    }
  }

  if (account.level === "ok" && (prevLevel === "low" || prevLevel === "empty")) {
    lowNotifiedAt = undefined;
    emptyNotifiedAt = undefined;
  }

  const updatedConfig = {
    ...config,
    cpaMonitor: {
      ...config.cpaMonitor,
      lowNotifiedAt,
      emptyNotifiedAt,
      lastLevel: account.level,
      checkedAt: now,
    },
  };

  await db.update(schema.channels)
    .set({ config: stringifyConfig(updatedConfig) })
    .where(eq(schema.channels.id, channel.id));

  return { ...account, checkedAt: new Date(now).toISOString() };
}

export async function checkAvitoCpaAdvance(forceNotify = false): Promise<AvitoCpaStatus> {
  if (running) return fetchAvitoCpaStatus();
  running = true;
  try {
    const settings = await getCrmSettings();
    const threshold = settings.avitoAdvanceThresholdRub ?? 200;
    const alertsEnabled = settings.avitoAdvanceAlertEnabled !== false;
    const channels = await getAllActiveAvitoChannels();

    if (channels.length === 0) {
      return { configured: false, accounts: [], level: "unknown", threshold, alertsEnabled };
    }

    if (!alertsEnabled && !forceNotify) {
      return fetchAvitoCpaStatus();
    }

    const accounts: AvitoCpaAccountStatus[] = [];
    for (const ch of channels) {
      accounts.push(await checkChannelAlerts(ch, threshold, alertsEnabled, forceNotify));
    }

    const level = worstLevel(accounts);
    const latestCheck = accounts.map((a) => a.checkedAt).filter(Boolean).sort().pop();

    return {
      configured: true,
      accounts,
      threshold,
      alertsEnabled,
      level,
      checkedAt: latestCheck,
      ...legacyFields(accounts, threshold),
    };
  } finally {
    running = false;
  }
}

export function startAvitoCpaMonitor() {
  if (timer) return;
  const tick = () => {
    checkAvitoCpaAdvance().catch((e) => console.error("[avito-cpa]", e.message));
  };
  tick();
  timer = setInterval(tick, POLL_MS);
  console.log("[avito-cpa] мониторинг аванса CPA (все аккаунты) запущен (каждые 10 мин)");
}
