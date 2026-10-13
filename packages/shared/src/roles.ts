/**
 * Who can do what.
 *
 *  corporate_admin   every store; the only role that can change settings, stores, recorders and logins
 *  corporate_viewer  every store, read only
 *  franchise_owner   only the stores of their franchisee, read only (numbers + report downloads)
 *
 * The API enforces this on every request (apps/api/src/middleware). The portal only uses these
 * helpers to decide what to draw.
 */

export const ROLES = ['corporate_admin', 'corporate_viewer', 'franchise_owner'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  corporate_admin: 'Corporate admin',
  corporate_viewer: 'Corporate viewer',
  franchise_owner: 'Franchise owner',
};

export function isRole(v: unknown): v is Role {
  return typeof v === 'string' && (ROLES as readonly string[]).includes(v);
}

/** Sees every store (null scope). */
export function isCorporate(role: Role): boolean {
  return role === 'corporate_admin' || role === 'corporate_viewer';
}

/** May change settings, stores, recorders, counting areas, logins, and upload POS data. */
export function canManage(role: Role): boolean {
  return role === 'corporate_admin';
}
