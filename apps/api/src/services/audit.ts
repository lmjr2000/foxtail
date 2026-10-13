import { q } from '../db/pool.js';

/** Record a change. Never throws: an audit failure must not undo the change it describes. */
export async function audit(userId: string | null, action: string, storeId: string | null, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await q('INSERT INTO audit_log (user_id, action, store_id, detail) VALUES ($1, $2, $3, $4)', [userId, action, storeId, JSON.stringify(detail)]);
  } catch (err) {
    console.error('[audit] failed to record', action, err);
  }
}
