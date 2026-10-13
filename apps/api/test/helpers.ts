import request from 'supertest';
import { DEFAULT_HOURS, type Role } from '@foxtail/shared';
import { createApp } from '../src/app.js';
import { q, runMigrations } from '../src/db/pool.js';
import { newId } from '../src/lib/ids.js';
import { signSession } from '../src/middleware/auth.js';
import { createUser } from '../src/services/users.js';
import { resetLoginLimits } from '../src/routes/auth.js';

export const app = createApp({ portalDir: null });
export const api = () => request(app);

export async function resetDb(): Promise<void> {
  await runMigrations();
  await q(`TRUNCATE audit_log, accuracy_checks, pos_hourly, samples, zones, counting_profiles, cameras, recorders, stores, users, franchisees RESTART IDENTITY CASCADE`);
  resetLoginLimits();
}

export const PASSWORD = 'correct horse 42';

export async function makeUser(role: Role, franchiseeId: string | null = null, email = `${role}-${newId('x')}@example.com`) {
  const user = await createUser({ email, name: role, role, franchiseeId, password: PASSWORD, mustChangePassword: false });
  return { user, token: signSession(user), auth: { Authorization: `Bearer ${signSession(user)}` } };
}

export async function makeFranchisee(name: string): Promise<string> {
  const id = newId('fr');
  await q('INSERT INTO franchisees (id, name) VALUES ($1, $2)', [id, name]);
  return id;
}

export async function makeStore(name: string, franchiseeId: string | null, timezone = 'America/Chicago'): Promise<string> {
  const id = newId('st');
  await q('INSERT INTO stores (id, name, timezone, opening_hours, franchisee_id) VALUES ($1,$2,$3,$4,$5)', [id, name, timezone, JSON.stringify(DEFAULT_HOURS), franchiseeId]);
  return id;
}

/** Two franchisees with their own stores, one corporate store, and a login for every role. */
export async function seedWorld() {
  const frA = await makeFranchisee('Alpha Coffee LLC');
  const frB = await makeFranchisee('Bravo Beans Inc');
  const storeA1 = await makeStore('Alpha Downtown', frA);
  const storeA2 = await makeStore('Alpha Airport', frA, 'America/New_York');
  const storeB1 = await makeStore('Bravo Riverside SECRET', frB);
  const storeC = await makeStore('Corporate Flagship', null);
  return {
    frA, frB, storeA1, storeA2, storeB1, storeC,
    admin: await makeUser('corporate_admin'),
    viewer: await makeUser('corporate_viewer'),
    ownerA: await makeUser('franchise_owner', frA),
    ownerB: await makeUser('franchise_owner', frB),
  };
}
