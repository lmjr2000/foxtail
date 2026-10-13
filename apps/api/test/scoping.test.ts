/**
 * The franchise-owner rule, proven against the real API and database:
 * a franchise owner can only ever see their own franchisee's stores, by list, by URL, by report,
 * and cannot tell that other stores exist.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import storeRoutes from '../src/routes/stores.js';
import { q } from '../src/db/pool.js';
import { api, PASSWORD, resetDb, seedWorld } from './helpers.js';

let w: Awaited<ReturnType<typeof seedWorld>>;

beforeAll(async () => {
  await resetDb();
  w = await seedWorld();
});

/** Every route registered on the stores router that takes a :storeId, with each HTTP method. */
function storeRoutesWithId(): Array<{ method: string; path: string }> {
  const out: Array<{ method: string; path: string }> = [];
  for (const layer of (storeRoutes as unknown as { stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }> }).stack) {
    const r = layer.route;
    if (!r || !r.path.includes(':storeId')) continue;
    for (const m of Object.keys(r.methods)) if (r.methods[m]) out.push({ method: m, path: r.path });
  }
  return out;
}

function fill(path: string, storeId: string): string {
  return '/api' + path.replace(':storeId', storeId).replace(':cameraId', 'cam_0000000000000000').replace(':checkId', 'acc_0000000000000000').replace(':date', '2026-01-01');
}

function send(method: string, url: string, headers: Record<string, string>) {
  const r = api()[method as 'get'](url).set(headers);
  return method === 'get' || method === 'delete' ? r : r.send({});
}

describe('store list', () => {
  it('franchise owner sees only their franchisee stores', async () => {
    const res = await api().get('/api/stores').set(w.ownerA.auth);
    expect(res.status).toBe(200);
    expect(res.body.stores.map((s: { id: string }) => s.id).sort()).toEqual([w.storeA1, w.storeA2].sort());
    expect(JSON.stringify(res.body)).not.toContain('Bravo');
    expect(JSON.stringify(res.body)).not.toContain('Corporate Flagship');
  });

  it('corporate roles see every store', async () => {
    for (const u of [w.admin, w.viewer]) {
      const res = await api().get('/api/stores').set(u.auth);
      expect(res.body.stores).toHaveLength(4);
    }
  });
});

describe('every per-store route', () => {
  const routes = storeRoutesWithId();

  it('the router really has per-store routes to check', () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it("answers 404 to another franchisee's store, for every method, before doing anything", async () => {
    for (const r of routes) {
      for (const target of [w.storeB1, w.storeC]) {
        const res = await send(r.method, fill(r.path, target), w.ownerA.auth);
        expect({ route: `${r.method.toUpperCase()} ${r.path}`, status: res.status }).toEqual({ route: `${r.method.toUpperCase()} ${r.path}`, status: 404 });
        expect(res.text).not.toContain('Bravo');
        expect(res.text).not.toContain('Flagship');
      }
    }
  });

  it('cannot tell "not yours" from "does not exist"', async () => {
    const notMine = await api().get(`/api/stores/${w.storeB1}/insights`).set(w.ownerA.auth);
    const missing = await api().get('/api/stores/st_doesnotexist000/insights').set(w.ownerA.auth);
    expect(notMine.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(notMine.body).toEqual(missing.body);
  });

  it('nothing changed in the other franchisee store after all those requests', async () => {
    const r = await q('SELECT name, archived_at FROM stores WHERE id = $1', [w.storeB1]);
    expect(r.rows[0]).toMatchObject({ name: 'Bravo Riverside SECRET', archived_at: null });
    const z = await q('SELECT COUNT(*)::int AS n FROM zones WHERE store_id = $1', [w.storeB1]);
    expect(z.rows[0].n).toBe(0);
  });

  it('owner can read their own store numbers and download reports', async () => {
    for (const path of ['', '/insights?range=today', '/report.pdf', '/report.csv', '/hourly.csv', '/pos-compare?range=7d', '/pos-compare.csv']) {
      const res = await api().get(`/api/stores/${w.storeA1}${path}`).set(w.ownerA.auth);
      expect({ path, status: res.status }).toEqual({ path, status: 200 });
    }
  });

  it('owner cannot change settings or see recorder details, even for their own store', async () => {
    const tries: Array<[string, string, object?]> = [
      ['patch', '', { name: 'Hacked' }],
      ['delete', ''],
      ['put', '/recorder', { vendor: 'uniview', connection: 'direct', host: '1.2.3.4' }],
      ['get', '/recorder'],
      ['get', '/cameras'],
      ['post', '/cameras', { name: 'x', channel: 1 }],
      ['get', '/counting'],
      ['put', '/counting/profile', { samplingEnabled: false }],
      ['put', '/counting/zones', { zones: [] }],
      ['post', '/pos-upload', { csv: 'Hour,Net Sales\n8,10' }],
      ['get', '/accuracy'],
    ];
    for (const [method, path, body] of tries) {
      const req = api()[method as 'get'](`/api/stores/${w.storeA1}${path}`).set(w.ownerA.auth);
      const res = body ? await req.send(body) : await req;
      expect({ call: `${method} ${path}`, status: res.status }).toEqual({ call: `${method} ${path}`, status: 403 });
    }
    const r = await q('SELECT name FROM stores WHERE id = $1', [w.storeA1]);
    expect(r.rows[0].name).toBe('Alpha Downtown');
  });

  it('corporate viewer reads everything but changes nothing', async () => {
    expect((await api().get(`/api/stores/${w.storeB1}/insights`).set(w.viewer.auth)).status).toBe(200);
    expect((await api().get(`/api/stores/${w.storeB1}/recorder`).set(w.viewer.auth)).status).toBe(200);
    expect((await api().patch(`/api/stores/${w.storeB1}`).set(w.viewer.auth).send({ name: 'x' })).status).toBe(403);
    expect((await api().post('/api/stores').set(w.viewer.auth).send({ name: 'x' })).status).toBe(403);
  });
});

describe('overview and all-stores reports', () => {
  it('franchise owner overview covers only their stores', async () => {
    const res = await api().get('/api/overview?range=7d').set(w.ownerA.auth);
    expect(res.status).toBe(200);
    expect(res.body.totals.stores).toBe(2);
    expect(res.body.stores.map((s: { storeId: string }) => s.storeId).sort()).toEqual([w.storeA1, w.storeA2].sort());
    expect(JSON.stringify(res.body)).not.toMatch(/Bravo|Flagship/);
  });

  it('franchise owner all-stores downloads contain only their stores', async () => {
    const csv = await api().get('/api/reports/all-stores.csv?range=7d').set(w.ownerA.auth);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('Alpha Downtown');
    expect(csv.text).not.toMatch(/Bravo|Flagship/);
    const pdf = await api().get('/api/reports/all-stores.pdf?range=7d').set(w.ownerA.auth).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF')).toBe(true);
    expect(text).toContain('Alpha Downtown');
    expect(text).not.toMatch(/Bravo|Flagship/);
  });

  it('corporate overview covers every store', async () => {
    const res = await api().get('/api/overview?range=today').set(w.admin.auth);
    expect(res.body.totals.stores).toBe(4);
  });
});

describe('corporate-only lists', () => {
  it('franchise owners cannot list franchisees, logins or the audit log', async () => {
    for (const path of ['/api/franchisees', '/api/users', '/api/audit']) {
      expect((await api().get(path).set(w.ownerA.auth)).status).toBe(403);
    }
  });
});

describe('access changes apply on the next request', () => {
  it('moving an owner to another franchisee changes what they see; their old session ends', async () => {
    const owner = await (await import('./helpers.js')).makeUser('franchise_owner', w.frA);
    expect((await api().get(`/api/stores/${w.storeA1}`).set(owner.auth)).status).toBe(200);
    const res = await api().patch(`/api/users/${owner.user.id}`).set(w.admin.auth).send({ franchiseeId: w.frB });
    expect(res.status).toBe(200);
    expect((await api().get(`/api/stores/${w.storeA1}`).set(owner.auth)).status).toBe(401);
    const login = await api().post('/api/auth/login').send({ email: owner.user.email, password: PASSWORD });
    const auth = { Authorization: `Bearer ${login.body.token}` };
    expect((await api().get(`/api/stores/${w.storeA1}`).set(auth)).status).toBe(404);
    expect((await api().get(`/api/stores/${w.storeB1}`).set(auth)).status).toBe(200);
  });

  it('a disabled login is refused immediately', async () => {
    const owner = await (await import('./helpers.js')).makeUser('franchise_owner', w.frA);
    await api().patch(`/api/users/${owner.user.id}`).set(w.admin.auth).send({ disabled: true });
    expect((await api().get('/api/stores').set(owner.auth)).status).toBe(401);
    expect((await api().post('/api/auth/login').send({ email: owner.user.email, password: PASSWORD })).status).toBe(401);
  });

  it('a franchise owner cannot be created without a franchisee', async () => {
    const res = await api().post('/api/users').set(w.admin.auth).send({ email: 'nofr@example.com', role: 'franchise_owner' });
    expect(res.status).toBe(400);
  });
});
