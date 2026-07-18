export type ChannelType = "telegram" | "avito" | "whatsapp" | "vk" | "max" | "instagram" | "email" | "manual";

export type ChannelConfig = {
  botToken?: string;
  botUsername?: string;
  /** Токен бота MAX (platform-api2.max.ru) */
  maxToken?: string;
  token?: string;
  clientId?: string;
  clientSecret?: string;
  userId?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  phoneNumberId?: string;
  whatsappToken?: string;
  /** Имя одобренного шаблона Meta для рассылок вне 24ч */
  whatsappTemplateName?: string;
  whatsappTemplateLang?: string;
  verifyToken?: string;
  /** App Secret из Meta Developer (для X-Hub-Signature-256) */
  appSecret?: string;
  groupId?: string;
  vkToken?: string;
  /** Код подтверждения Callback API VK */
  confirmationCode?: string;
  webhookSecret?: string;
  cpaMonitor?: {
    advance?: number;
    cpaBalance?: number;
    wallet?: number | null;
    balance?: number;
    debt?: number;
    checkedAt?: number;
    lowNotifiedAt?: number;
    emptyNotifiedAt?: number;
    lastLevel?: "ok" | "low" | "empty" | "unknown";
  };
};

export function parseConfig(raw: string | null | undefined): ChannelConfig {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as ChannelConfig;
  } catch {
    return {};
  }
}

export function stringifyConfig(config: ChannelConfig): string {
  return JSON.stringify(config);
}

export const CHANNEL_TYPES: { id: ChannelType; label: string; icon: string }[] = [
  { id: "telegram", label: "Telegram", icon: "✈️" },
  { id: "avito", label: "Авито", icon: "🏠" },
  { id: "whatsapp", label: "WhatsApp", icon: "📱" },
  { id: "max", label: "MAX", icon: "💬" },
  { id: "vk", label: "ВКонтакте", icon: "🔵" },
  { id: "instagram", label: "Instagram", icon: "📸" },
  { id: "email", label: "Email", icon: "✉️" },
  { id: "manual", label: "Вручную", icon: "✏️" },
];
