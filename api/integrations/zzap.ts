import { getPublicUrl } from "../lib/config";

const ZZAP_UPLOAD_URL = "https://api.zzap.pro/webservice/datasharing.asmx/UploadTemplatePrice";

export type ZzapUploadInput = {
  login: string;
  password: string;
  apiKey: string;
  codeTemplate: number;
  fileName: string;
  fileBuffer: Buffer;
  publicFileUrl?: string;
};

function encodeBase64ForZzap(buf: Buffer): string {
  return buf.toString("base64")
    .replace(/\//g, "%2F")
    .replace(/\+/g, "%2B")
    .replace(/=/g, "%3D");
}

export function isZzapNewApiKey(key?: string | null): boolean {
  return Boolean(key?.startsWith("zzap1_"));
}

function apiKeyHint(key: string) {
  if (isZzapNewApiKey(key)) {
    return "Ключ zzap1_… не подходит для старого UploadTemplatePrice. В шаблоне ZZap выберите «Внешняя ссылка» и вставьте URL из CRM — ZZap сам забирает файл.";
  }
  return null;
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

export async function uploadZzapTemplatePrice(input: ZzapUploadInput): Promise<{ ok: boolean; error?: string; fileUrl?: string }> {
  const keyHint = apiKeyHint(input.apiKey);
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
    params.set("file_body", encodeBase64ForZzap(input.fileBuffer));
  }

  const res = await fetch(ZZAP_UPLOAD_URL, {
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
    const err = String(data.error);
    if (err.includes("api_key") && keyHint) return { ok: false, error: `${err} ${keyHint}` };
    return { ok: false, error: err };
  }
  return { ok: true, fileUrl: data.file_url };
}

/** Стабильная ссылка по коду шаблона ZZap (не меняется при пересоздании прайса в CRM). */
export function zzapPublicFileUrl(codeTemplate: number) {
  const base = getPublicUrl();
  if (!base.startsWith("https://")) return null;
  const path = `${base}/api/zzap/template/${codeTemplate}/price.xlsx`;
  const token = process.env.ZZAP_PUBLIC_TOKEN?.trim();
  return token ? `${path}?t=${encodeURIComponent(token)}` : path;
}
