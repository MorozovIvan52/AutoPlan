import { sqlAll, sqlRun } from "../database/raw-sql";

export async function logDealAudit(dealId: number, userId: number | null | undefined, action: string, detail?: string) {
  try {
    await sqlRun(`
      INSERT INTO deal_audit_log (deal_id, user_id, action, detail, created_at)
      VALUES (?, ?, ?, ?, ?)
    `, dealId, userId ?? null, action, detail ?? null, Date.now());
  } catch (e: unknown) {
    // таблица создаётся ensureStoExtendedTables; не валим запрос ЗН
    console.warn("[sto-audit]", (e as Error)?.message || e);
  }
}

export async function getDealAuditLog(dealId: number, limit = 100) {
  return sqlAll(`
    SELECT a.*, u.name as user_name
    FROM deal_audit_log a
    LEFT JOIN users u ON u.id = a.user_id
    WHERE a.deal_id = ?
    ORDER BY a.created_at DESC
    LIMIT ?
  `, dealId, limit);
}

export async function getDealNotes(dealId: number) {
  return sqlAll(`
    SELECT n.*, u.name as user_name
    FROM deal_notes n
    LEFT JOIN users u ON u.id = n.user_id
    WHERE n.deal_id = ?
    ORDER BY n.created_at DESC
  `, dealId);
}

export async function addDealNote(dealId: number, userId: number, text: string) {
  const r = await sqlRun(`
    INSERT INTO deal_notes (deal_id, user_id, text, created_at) VALUES (?, ?, ?, ?)
  `, dealId, userId, text.trim(), Date.now());
  await logDealAudit(dealId, userId, "note", text.trim().slice(0, 200));
  return r.lastInsertRowid;
}
