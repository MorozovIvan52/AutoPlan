import { normalizePhone } from "./common";

export type MtsIncomingRequest = {
  method?: string;
  params?: {
    numbers?: { a?: string; b?: string };
    numberA?: string;
    caller?: string;
    callId?: string;
    client_id?: string;
  };
  numbers?: { a?: string; b?: string };
};

export function parseMtsCaller(body: MtsIncomingRequest): string | null {
  const p = body.params || body;
  const nums = (p as any).numbers || body.numbers;
  const phone = nums?.a || (p as any).numberA || (p as any).caller;
  return phone ? normalizePhone(phone) : null;
}

export function buildMtsFollowMeResponse(redirectNumber: string, callId?: string) {
  return {
    result: {
      redirect_type: 1,
      client_id: callId || undefined,
      followme_struct: [{
        redirect_number: normalizePhone(redirectNumber),
        active: true,
        timeout: 30,
      }],
    },
  };
}

export async function mtsMakeCallback(apiKey: string, appId: string, operatorPhone: string, clientPhone: string) {
  const res = await fetch("https://api.exolve.ru/call/v1/MakeCallBack", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      application_id: appId,
      a_number: normalizePhone(operatorPhone),
      b_number: normalizePhone(clientPhone),
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`МТС Exolve: ${err || res.statusText}`);
  }
  return res.json();
}

export type MtsCallbackEvent = {
  event?: string;
  call_id?: string;
  caller?: string;
  callee?: string;
  duration?: number;
  status?: string;
  record_url?: string;
};
