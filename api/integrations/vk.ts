import type { ChannelConfig } from "../lib/channel-config";

export async function sendVkMessage(
  config: ChannelConfig,
  peerId: string,
  text: string,
): Promise<{ ok: boolean; externalMessageId?: string; error?: string }> {
  const token = config.vkToken || config.accessToken;
  if (!token) return { ok: false, error: "Укажите токен сообщества VK" };
  const res = await fetch(`https://api.vk.com/method/messages.send?${new URLSearchParams({
    access_token: token,
    peer_id: peerId,
    message: text,
    random_id: String(Math.floor(Math.random() * 1e9)),
    v: "5.199",
  })}`, { method: "POST" });
  const data = await res.json() as any;
  if (data.error) return { ok: false, error: data.error.error_msg };
  return { ok: true, externalMessageId: String(data.response) };
}

export function parseVkWebhook(body: any) {
  const obj = body?.object;
  if (body?.type !== "message_new" || !obj?.message) return null;
  const msg = obj.message;
  return {
    externalUserId: String(msg.from_id || msg.user_id),
    externalChatId: String(msg.peer_id),
    senderName: `VK ${msg.from_id}`,
    text: msg.text || "[медиа]",
    externalMessageId: String(msg.id || msg.conversation_message_id),
  };
}
