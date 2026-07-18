import { sqlAll } from "../database/raw-sql";
import { getTenantId } from "./tenant-context";

export type ChatSearchHit = {
  conversationId: number;
  snippet: string;
  source: "message" | "ocr" | "client" | "metadata";
};

function escapeLike(q: string): string {
  return q.replace(/[%_\\]/g, (c) => `\\${c}`);
}

function makeSnippet(text: string, query: string, maxLen = 120): string {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  const idx = lower.indexOf(q);
  if (idx < 0) return text.slice(0, maxLen) + (text.length > maxLen ? "…" : "");
  const start = Math.max(0, idx - 40);
  const end = Math.min(text.length, idx + query.length + 60);
  let s = text.slice(start, end);
  if (start > 0) s = "…" + s;
  if (end < text.length) s += "…";
  return s;
}

/** Поиск диалогов: клиент, метаданные, текст и OCR сообщений. */
export async function searchConversationIds(query: string): Promise<Map<number, ChatSearchHit>> {
  const q = query.trim();
  const hits = new Map<number, ChatSearchHit>();
  if (q.length < 2) return hits;

  const pattern = `%${escapeLike(q)}%`;
  const tid = getTenantId();

  const clientRows = await sqlAll<{
    convId: number; name: string; phone: string | null; notes: string | null;
  }>(`
    SELECT c.id AS convId, cl.name, cl.phone, cl.notes
    FROM conversations c
    INNER JOIN clients cl ON cl.id = c.client_id
    WHERE c.tenant_id = ? AND cl.tenant_id = ?
      AND (cl.name LIKE ? ESCAPE '\\'
       OR COALESCE(cl.phone, '') LIKE ? ESCAPE '\\'
       OR COALESCE(cl.notes, '') LIKE ? ESCAPE '\\'
       OR COALESCE(cl.email, '') LIKE ? ESCAPE '\\')
  `, tid, tid, pattern, pattern, pattern, pattern);

  for (const row of clientRows) {
    const text = [row.name, row.phone, row.notes].filter(Boolean).join(" ");
    hits.set(row.convId, { conversationId: row.convId, snippet: makeSnippet(text, q), source: "client" });
  }

  const metaRows = await sqlAll<{ convId: number; metadata: string }>(`
    SELECT id AS convId, metadata FROM conversations
    WHERE tenant_id = ? AND metadata IS NOT NULL AND metadata LIKE ? ESCAPE '\\'
  `, tid, pattern);

  for (const row of metaRows) {
    if (hits.has(row.convId)) continue;
    try {
      const meta = JSON.parse(row.metadata);
      const title = meta.avitoItemTitle || meta.avito_item_title || "";
      if (title) {
        hits.set(row.convId, { conversationId: row.convId, snippet: makeSnippet(String(title), q), source: "metadata" });
      }
    } catch { /* */ }
  }

  const msgRows = await sqlAll<{ convId: number; text: string | null; ocrText: string | null }>(`
    SELECT m.conversation_id AS convId, m.text, m.ocr_text AS ocrText
    FROM messages m
    INNER JOIN conversations c ON c.id = m.conversation_id
    WHERE c.tenant_id = ?
      AND (
      (m.text IS NOT NULL AND m.text LIKE ? ESCAPE '\\')
      OR (m.ocr_text IS NOT NULL AND m.ocr_text LIKE ? ESCAPE '\\')
    )
    ORDER BY m.created_at DESC
    LIMIT 200
  `, tid, pattern, pattern);

  for (const row of msgRows) {
    if (hits.has(row.convId)) continue;
    const fromOcr = row.ocrText && row.ocrText.toLowerCase().includes(q.toLowerCase());
    const body = fromOcr ? row.ocrText! : (row.text || "");
    hits.set(row.convId, {
      conversationId: row.convId,
      snippet: fromOcr ? `📷 ${makeSnippet(body, q)}` : makeSnippet(body, q),
      source: fromOcr ? "ocr" : "message",
    });
  }

  return hits;
}

export function attachSearchHits<T extends { id: number }>(
  convs: T[],
  hits: Map<number, ChatSearchHit>,
): (T & { searchHit?: ChatSearchHit })[] {
  return convs.map((c) => {
    const hit = hits.get(c.id);
    return hit ? { ...c, searchHit: hit } : c;
  });
}
