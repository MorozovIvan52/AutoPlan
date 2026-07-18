import { normalizePhone } from "./common";

export function megafonApiEndpoint(baseUrl: string): string {
  const url = baseUrl.trim().replace(/\/$/, "");
  if (url.includes("crm_api.wcgp")) return url;
  return `${url}/sys/crm_api.wcgp`;
}

export async function megafonMakeCall(apiUrl: string, token: string, userExt: string, phone: string) {
  const endpoint = megafonApiEndpoint(apiUrl);
  const body = new URLSearchParams({
    crm_token: token,
    cmd: "makeCall",
    user: userExt,
    phone: normalizePhone(phone),
  });

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(`Мегафон ВАТС: ${text || res.statusText}`);
  return text;
}

export type MegafonEvent = {
  cmd?: string;
  type?: string;
  phone?: string;
  user?: string;
  callid?: string;
  ext?: string;
  duration?: string;
  link?: string;
  crm_token?: string;
};

export function parseMegafonBody(body: Record<string, string>): MegafonEvent {
  return {
    cmd: body.cmd,
    type: body.type,
    phone: body.phone || body.telnum || body.client,
    user: body.user || body.ext,
    callid: body.callid || body.call_id || body.id,
    ext: body.ext,
    duration: body.duration,
    link: body.link || body.record || body.recordlink,
    crm_token: body.crm_token,
  };
}

export function isMegafonIncoming(type?: string): boolean {
  if (!type) return false;
  const t = type.toUpperCase();
  return t === "INCOMING" || t === "RINGING" || t === "CALLING";
}

export function isMegafonCompleted(type?: string): boolean {
  if (!type) return false;
  const t = type.toUpperCase();
  return t === "COMPLETED" || t === "ACCEPTED" || t === "ANSWERED";
}

export function isMegafonMissed(type?: string): boolean {
  if (!type) return false;
  const t = type.toUpperCase();
  return t === "MISSED" || t === "CANCELLED" || t === "NOANSWER" || t === "NO_ANSWER";
}
