/**
 * Stores and the franchise-owner rule.
 *
 * Every read of a store goes through scopedStore() / listScopedStores(), which put the scope into the
 * SQL itself: a franchise owner's query only ever matches rows whose franchisee_id is theirs. There is
 * no code path that loads a store first and checks access afterwards.
 */
import { DEFAULT_TIMEZONE, type OperatingHours } from '@foxtail/shared';
import { q } from '../db/pool.js';
import type { AuthContext } from '../middleware/auth.js';

export interface Store {
  id: string;
  storeNumber: string | null;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  timezone: string;
  openingHours: OperatingHours;
  franchiseeId: string | null;
  franchiseeName: string | null;
  createdAt: string;
  updatedAt: string;
}

type Row = Record<string, unknown>;

export function rowToStore(r: Row): Store {
  return {
    id: String(r.id),
    storeNumber: (r.store_number as string) ?? null,
    name: String(r.name),
    address: (r.address as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    postalCode: (r.postal_code as string) ?? null,
    timezone: String(r.timezone || DEFAULT_TIMEZONE),
    openingHours: r.opening_hours as OperatingHours,
    franchiseeId: (r.franchisee_id as string) ?? null,
    franchiseeName: (r.franchisee_name as string) ?? null,
    createdAt: new Date(String(r.created_at)).toISOString(),
    updatedAt: new Date(String(r.updated_at)).toISOString(),
  };
}

const SELECT = `SELECT s.*, f.name AS franchisee_name FROM stores s LEFT JOIN franchisees f ON f.id = s.franchisee_id`;

/**
 * The store, when it exists, is not archived and is inside this login's scope. Otherwise null —
 * callers answer 404 either way, so "not yours" and "does not exist" look the same.
 */
export async function scopedStore(auth: AuthContext, storeId: string): Promise<Store | null> {
  if (typeof storeId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) return null;
  const r = await q(
    `${SELECT} WHERE s.id = $1 AND s.archived_at IS NULL AND ($2::text IS NULL OR s.franchisee_id = $2)`,
    [storeId, auth.franchiseeScope],
  );
  // Belt and braces: a franchise owner must have a franchisee. If that ever breaks, show nothing.
  if (auth.user.role === 'franchise_owner' && !auth.franchiseeScope) return null;
  return r.rows[0] ? rowToStore(r.rows[0]) : null;
}

/** Every store this login may see, by name. */
export async function listScopedStores(auth: AuthContext): Promise<Store[]> {
  if (auth.user.role === 'franchise_owner' && !auth.franchiseeScope) return [];
  const r = await q(
    `${SELECT} WHERE s.archived_at IS NULL AND ($1::text IS NULL OR s.franchisee_id = $1) ORDER BY lower(s.name), s.store_number`,
    [auth.franchiseeScope],
  );
  return r.rows.map(rowToStore);
}

/** Unscoped lookup for background jobs (sampler, edge ingest). Never use in a request handler. */
export async function storeForSystem(storeId: string): Promise<Store | null> {
  const r = await q(`${SELECT} WHERE s.id = $1 AND s.archived_at IS NULL`, [storeId]);
  return r.rows[0] ? rowToStore(r.rows[0]) : null;
}
