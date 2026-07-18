export type ConvAvitoMeta = {
  avitoItemId?: string;
  avitoItemTitle?: string;
  avitoPrice?: number;
  avitoItemUrl?: string;
  avitoAccountName?: string;
  avitoChannelId?: number;
};

export function parseConvMetadata(raw: string | null | undefined): ConvAvitoMeta | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ConvAvitoMeta;
  } catch {
    return null;
  }
}
