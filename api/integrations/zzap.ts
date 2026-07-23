import { getPublicUrl } from "../lib/config";

const ZZAP_UPLOAD_URL_OLD = "https://api.zzap.pro/webservice/datasharing.asmx/UploadTemplatePrice";
const ZZAP_UPLOAD_URL_NEW = "https://b52-api.zzap.pro/api/client/v1/upload/template/price";

export type ZzapUploadInput = {
  login: string;
  password: string;
  apiKey: string;
  codeTemplate: number;
  fileName: string;
  fileBuffer: Buffer;
  publicFileUrl?: string;
};

function encodeBase64ForZzapOld(buf: Buffer): string {
  return buf.toString("base64")
    .replace(/\//g, "%2F")
    .replace(/\+/g, "%2B")
    .replace(/=/g, "%3D");
}

export function isZzapNewApiKey(key?: string | null): boolean {
  return Boolean(key?.startsWith("zzap1_"));
}

/** Публикация через внешнюю ссылку — GET, т.к. ZZap качает файл целиком. */
export async function verifyZzapExternalUrl(url: string): Promise<{ ok: boolean; error?: string }> {
  if (!url.startsWith("https://")) {
    return { ok: false, error: "Нужен HTTPS (PUBLIC_URL в .env)" };
  }
  try {
    const res = await fetch(url, { method: "GET", cache: "no-store" });
    if (!res.ok) return { ok: false, error: `Ссылка недоступна: HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 100) return { ok: false, error: "Файл пустой или слишком маленький" };
    if (buf[0] !== 0x50 || buf[1] !== 0x4b) return { ok: false, error: "Ответ не похож на xlsx (zip)" };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

type NewApiResponse = {
  success?: boolean;
  code?: number;
  errors?: { error?: string } | Record<string, string> | string[] | string | null;
  result?: { file_url?: string };
};

function formatNewApiErrors(errors: NewApiResponse["errors"]): string {
  if (!errors) return "";
  if (typeof errors === "string") return errors;
  if (Array.isArray(errors)) return errors.join("; ");
  if (typeof errors === "object") {
    if ("error" in errors && errors.error) return String(errors.error);
    return Object.values(errors).filter(Boolean).join("; ");
  }
  return String(errors);
}

/** Новый API ZZap (ключ zzap1_…) — реальная загрузка прайса в кабинет. */
export async function uploadZzapTemplatePriceNew(input: ZzapUploadInput): Promise<{ ok: boolean; error?: string; fileUrl?: string }> {
  const useUrl = Boolean(input.publicFileUrl?.startsWith("https://"));
  const body = {
    url: useUrl ? input.publicFileUrl! : "",
    file_name: input.fileName || "price.xlsx",
    // wiki: оба поля обязательны; при url можно пустой body, при body — пустой url
    file_body: useUrl ? "" : input.fileBuffer.toString("base64"),
    code_templ: input.codeTemplate,
  };

  const res = await fetch(ZZAP_UPLOAD_URL_NEW, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "zzap-api-key": input.apiKey,
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let data: NewApiResponse = {};
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: `ZZap new API: не JSON (${res.status}): ${text.slice(0, 200)}` };
  }

  const err = formatNewApiErrors(data.errors);
  if (!res.ok || data.success === false) {
    // если url-режим не приняли — пробуем file_body
    if (useUrl && (err || res.status >= 400)) {
      const retry = await fetch(ZZAP_UPLOAD_URL_NEW, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "zzap-api-key": input.apiKey,
        },
        body: JSON.stringify({
          url: "",
          file_name: input.fileName || "price.xlsx",
          file_body: input.fileBuffer.toString("base64"),
          code_templ: input.codeTemplate,
        }),
      });
      const retryText = await retry.text();
      let retryData: NewApiResponse = {};
      try {
        retryData = JSON.parse(retryText);
      } catch {
        return { ok: false, error: err || `ZZap new API HTTP ${res.status}; retry not JSON` };
      }
      const retryErr = formatNewApiErrors(retryData.errors);
      if (!retry.ok || retryData.success === false) {
        return { ok: false, error: retryErr || err || `ZZap new API HTTP ${retry.status}` };
      }
      return { ok: true, fileUrl: retryData.result?.file_url || input.publicFileUrl };
    }
    return { ok: false, error: err || `ZZap new API HTTP ${res.status}` };
  }

  return { ok: true, fileUrl: data.result?.file_url || input.publicFileUrl };
}

/** Старый API (не zzap1_). */
export async function uploadZzapTemplatePriceOld(input: ZzapUploadInput): Promise<{ ok: boolean; error?: string; fileUrl?: string }> {
  const useUrl = Boolean(input.publicFileUrl?.startsWith("https://"));

  const params = new URLSearchParams();
  params.set("login", input.login);
  params.set("password", input.password);
  params.set("code_templ", String(input.codeTemplate));
  params.set("file_name", input.fileName);
  params.set("api_key", input.apiKey);

  if (useUrl && input.publicFileUrl) {
    params.set("url", input.publicFileUrl);
    params.set("file_body", "");
  } else {
    params.set("url", "");
    params.set("file_body", encodeBase64ForZzapOld(input.fileBuffer));
  }

  const res = await fetch(ZZAP_UPLOAD_URL_OLD, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
    body: params.toString(),
  });

  const text = await res.text();
  let data: { error?: string; file_url?: string } = {};
  try {
    data = JSON.parse(text);
  } catch {
    const errMatch = text.match(/"error"\s*:\s*"([^"]*)"/);
    const urlMatch = text.match(/"file_url"\s*:\s*"([^"]*)"/);
    data = { error: errMatch?.[1], file_url: urlMatch?.[1] };
  }

  if (!res.ok) {
    return { ok: false, error: data.error || `ZZap HTTP ${res.status}` };
  }
  if (data.error) {
    return { ok: false, error: String(data.error) };
  }
  return { ok: true, fileUrl: data.file_url };
}

export async function uploadZzapTemplatePrice(input: ZzapUploadInput): Promise<{ ok: boolean; error?: string; fileUrl?: string }> {
  if (isZzapNewApiKey(input.apiKey)) {
    return uploadZzapTemplatePriceNew(input);
  }
  return uploadZzapTemplatePriceOld(input);
}

/** Стабильная ссылка по коду шаблона ZZap (не меняется при пересоздании прайса в CRM). */
export function zzapPublicFileUrl(codeTemplate: number) {
  const base = getPublicUrl();
  if (!base.startsWith("https://")) return null;
  const path = `${base}/api/zzap/template/${codeTemplate}/price.xlsx`;
  const token = process.env.ZZAP_PUBLIC_TOKEN?.trim();
  return token ? `${path}?t=${encodeURIComponent(token)}` : path;
}
