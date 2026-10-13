/**
 * Logins and franchisees (corporate only).
 *
 * GET    /api/franchisees                  corporate (admin + viewer)
 * POST   /api/franchisees                  admin
 * PATCH  /api/franchisees/:id              admin
 * DELETE /api/franchisees/:id              admin (only when no stores or logins use it)
 * GET    /api/users                        admin
 * POST   /api/users                        admin -> { user, temporaryPassword } (shown once; no email is sent)
 * PATCH  /api/users/:id                    admin (name, role, franchiseeId, disabled)
 * POST   /api/users/:id/reset-password     admin -> { temporaryPassword }
 */
import { Router } from 'express';
import { isRole, type Role } from '@foxtail/shared';
import { q } from '../db/pool.js';
import { badRequest, conflict, notFound, str } from '../lib/http.js';
import { newId, tempPassword } from '../lib/ids.js';
import { requireCorporate, requireManager } from '../middleware/auth.js';
import { audit } from '../services/audit.js';
import { createUser, getUser, getUserRowByEmail, listUsers, setPassword, type User } from '../services/users.js';

const router = Router();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ------------------------------------------------------------------------------------- franchisees

function rowToFranchisee(r: Record<string, unknown>) {
  return {
    id: String(r.id), name: String(r.name), contactName: (r.contact_name as string) ?? null, contactEmail: (r.contact_email as string) ?? null,
    phone: (r.phone as string) ?? null, storeCount: Number(r.store_count ?? 0), loginCount: Number(r.login_count ?? 0),
  };
}

const FRANCHISEE_SELECT = `SELECT f.*,
  (SELECT COUNT(*) FROM stores s WHERE s.franchisee_id = f.id AND s.archived_at IS NULL)::int AS store_count,
  (SELECT COUNT(*) FROM users u WHERE u.franchisee_id = f.id)::int AS login_count
  FROM franchisees f`;

router.get('/franchisees', requireCorporate, async (_req, res) => {
  const r = await q(`${FRANCHISEE_SELECT} ORDER BY lower(f.name)`);
  res.json({ franchisees: r.rows.map(rowToFranchisee) });
});

function franchiseeFields(body: Record<string, unknown>) {
  const name = str(body.name, 120);
  const contactEmail = str(body.contactEmail, 200);
  if (contactEmail && !EMAIL.test(contactEmail)) throw badRequest('Contact email does not look right.');
  return { name, contactName: str(body.contactName, 120), contactEmail, phone: str(body.phone, 40) };
}

router.post('/franchisees', requireManager, async (req, res) => {
  const f = franchiseeFields(req.body || {});
  if (!f.name) throw badRequest('Name is required.');
  const id = newId('fr');
  await q('INSERT INTO franchisees (id, name, contact_name, contact_email, phone) VALUES ($1,$2,$3,$4,$5)', [id, f.name, f.contactName, f.contactEmail, f.phone]);
  await audit(req.auth!.user.id, 'franchisee.created', null, { franchiseeId: id, name: f.name });
  const r = await q(`${FRANCHISEE_SELECT} WHERE f.id = $1`, [id]);
  res.status(201).json({ franchisee: rowToFranchisee(r.rows[0]) });
});

router.patch('/franchisees/:id', requireManager, async (req, res) => {
  const f = franchiseeFields(req.body || {});
  const r = await q(
    `UPDATE franchisees SET name = COALESCE($2, name), contact_name = $3, contact_email = $4, phone = $5, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [req.params.id, f.name, f.contactName, f.contactEmail, f.phone],
  );
  if (!r.rowCount) throw notFound();
  await audit(req.auth!.user.id, 'franchisee.updated', null, { franchiseeId: req.params.id });
  const out = await q(`${FRANCHISEE_SELECT} WHERE f.id = $1`, [req.params.id]);
  res.json({ franchisee: rowToFranchisee(out.rows[0]) });
});

router.delete('/franchisees/:id', requireManager, async (req, res) => {
  const r = await q(`${FRANCHISEE_SELECT} WHERE f.id = $1`, [req.params.id]);
  if (!r.rows[0]) throw notFound();
  const f = rowToFranchisee(r.rows[0]);
  const archived = await q('SELECT COUNT(*)::int AS n FROM stores WHERE franchisee_id = $1', [f.id]);
  if (f.storeCount || f.loginCount || Number(archived.rows[0].n)) throw conflict('Move its stores and logins to another franchisee first.');
  await q('DELETE FROM franchisees WHERE id = $1', [f.id]);
  await audit(req.auth!.user.id, 'franchisee.deleted', null, { franchiseeId: f.id, name: f.name });
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------- users

function adminView(u: User) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, franchiseeId: u.franchiseeId, disabled: u.disabled, mustChangePassword: u.mustChangePassword, googleLinked: u.googleLinked, lastLoginAt: u.lastLoginAt, createdAt: u.createdAt };
}

async function checkRoleFranchisee(role: Role, franchiseeId: string | null): Promise<string | null> {
  if (role !== 'franchise_owner') return null;
  if (!franchiseeId) throw badRequest('Pick the franchisee this owner belongs to.');
  const r = await q('SELECT 1 FROM franchisees WHERE id = $1', [franchiseeId]);
  if (!r.rowCount) throw badRequest('That franchisee does not exist.');
  return franchiseeId;
}

/** Never leave the system without an active corporate admin. */
async function assertAnotherAdmin(exceptUserId: string): Promise<void> {
  const r = await q(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'corporate_admin' AND disabled_at IS NULL AND id <> $1`, [exceptUserId]);
  if (!Number(r.rows[0].n)) throw conflict('There must always be at least one active corporate admin.');
}

router.get('/users', requireManager, async (_req, res) => {
  res.json({ users: (await listUsers()).map(adminView) });
});

router.post('/users', requireManager, async (req, res) => {
  const b = req.body || {};
  const email = str(b.email, 200);
  if (!email || !EMAIL.test(email)) throw badRequest('Enter a valid email address.');
  if (!isRole(b.role)) throw badRequest('Pick a role.');
  if (await getUserRowByEmail(email)) throw conflict('There is already a login with that email.');
  const franchiseeId = await checkRoleFranchisee(b.role, str(b.franchiseeId, 64));
  const temporaryPassword = tempPassword();
  const user = await createUser({ email, name: str(b.name, 120) ?? '', role: b.role, franchiseeId, password: temporaryPassword, mustChangePassword: true });
  await audit(req.auth!.user.id, 'user.created', null, { userId: user.id, email: user.email, role: user.role, franchiseeId });
  res.status(201).json({ user: adminView(user), temporaryPassword });
});

router.patch('/users/:id', requireManager, async (req, res) => {
  const target = await getUser(String(req.params.id));
  if (!target) throw notFound();
  const b = req.body || {};
  const role: Role = b.role === undefined ? target.role : isRole(b.role) ? b.role : (() => { throw badRequest('Unknown role.'); })();
  const franchiseeId = await checkRoleFranchisee(role, b.franchiseeId === undefined ? target.franchiseeId : str(b.franchiseeId, 64));
  const disabled = b.disabled === undefined ? target.disabled : b.disabled === true;
  const name = b.name === undefined ? target.name : (str(b.name, 120) ?? '');
  const losingAdmin = target.role === 'corporate_admin' && (role !== 'corporate_admin' || disabled);
  if (losingAdmin) await assertAnotherAdmin(target.id);
  // Role, franchisee or disable changes end the login's current sessions.
  const bump = role !== target.role || franchiseeId !== target.franchiseeId || disabled !== target.disabled;
  await q(
    `UPDATE users SET name = $2, role = $3, franchisee_id = $4, disabled_at = CASE WHEN $5 THEN COALESCE(disabled_at, NOW()) ELSE NULL END,
       token_version = token_version + $6, updated_at = NOW() WHERE id = $1`,
    [target.id, name, role, franchiseeId, disabled, bump ? 1 : 0],
  );
  await audit(req.auth!.user.id, 'user.updated', null, { userId: target.id, role, franchiseeId, disabled });
  res.json({ user: adminView((await getUser(target.id))!) });
});

router.post('/users/:id/reset-password', requireManager, async (req, res) => {
  const target = await getUser(String(req.params.id));
  if (!target) throw notFound();
  const temporaryPassword = tempPassword();
  await setPassword(target.id, temporaryPassword, true);
  await audit(req.auth!.user.id, 'user.password_reset', null, { userId: target.id });
  res.json({ temporaryPassword });
});

router.get('/audit', requireManager, async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
  const r = await q(
    `SELECT a.*, u.email AS user_email, s.name AS store_name FROM audit_log a
       LEFT JOIN users u ON u.id = a.user_id LEFT JOIN stores s ON s.id = a.store_id ORDER BY a.at DESC LIMIT $1`, [limit]);
  res.json({ entries: r.rows.map(x => ({ at: new Date(x.at as string).toISOString(), user: x.user_email ?? null, action: x.action, store: x.store_name ?? null, detail: x.detail })) });
});

export default router;
