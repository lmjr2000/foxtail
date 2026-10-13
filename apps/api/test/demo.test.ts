import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { api, resetDb } from './helpers.js';
import { ensureDemoStructure, fillDemoData } from '../src/services/demo.js';
import { q } from '../src/db/pool.js';

beforeAll(async () => {
  await resetDb();
  await ensureDemoStructure();
});
afterEach(() => { delete process.env.DEMO_MODE; });

async function enter(as: 'corporate' | 'owner') {
  process.env.DEMO_MODE = 'true';
  const r = await api().post('/api/auth/demo').send({ as });
  expect(r.status).toBe(200);
  return { Authorization: `Bearer ${r.body.token}` };
}

describe('demo mode', () => {
  it('the demo buttons do not exist unless DEMO_MODE=true', async () => {
    expect((await api().post('/api/auth/demo').send({ as: 'corporate' })).status).toBe(404);
    expect((await api().get('/api/auth/config')).body.demo).toBe(false);
    process.env.DEMO_MODE = 'true';
    expect((await api().get('/api/auth/config')).body.demo).toBe(true);
  });

  it('demo corporate sees every example store but cannot change anything', async () => {
    const h = await enter('corporate');
    const stores = await api().get('/api/stores').set(h);
    expect(stores.body.stores).toHaveLength(5);
    const id = stores.body.stores[0].id;
    expect((await api().get(`/api/stores/${id}/counting`).set(h)).status).toBe(200);
    expect((await api().patch(`/api/stores/${id}`).set(h).send({ name: 'x' })).status).toBe(403);
    expect((await api().post('/api/users').set(h).send({ email: 'a@b.co', role: 'corporate_admin' })).status).toBe(403);
    expect((await api().post('/api/auth/change-password').set(h).send({ currentPassword: 'x', newPassword: 'abcdefgh123' })).status).toBe(403);
  });

  it('demo franchise owner sees only their franchisee stores', async () => {
    const h = await enter('owner');
    const stores = await api().get('/api/stores').set(h);
    expect(stores.body.stores.map((s: { name: string }) => s.name).sort()).toEqual(['EXAMPLE – Jackson Fondren', 'EXAMPLE – Ridgeland']);
    expect((await api().get('/api/stores/st_demo_oxford').set(h)).status).toBe(404);
  });

  it('example counts fill in up to now without duplicates, and reports say DEMO', async () => {
    const now = new Date();
    const first = await fillDemoData(now);
    expect(first).toBeGreaterThan(0);
    expect(await fillDemoData(now)).toBe(0);
    const later = await fillDemoData(new Date(now.getTime() + 10 * 60_000));
    expect(later).toBeGreaterThanOrEqual(0);
    const dup = await q('SELECT COUNT(*)::int AS n FROM (SELECT zone_id, round_at FROM samples GROUP BY 1, 2 HAVING COUNT(*) > 1) d');
    expect(dup.rows[0].n).toBe(0);
    const h = await enter('corporate');
    const csv = await api().get('/api/reports/all-stores.csv?range=7d').set(h);
    expect(csv.text).toContain('DEMO');
  });
});
