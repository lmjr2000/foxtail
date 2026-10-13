/**
 * End to end with real numbers: an admin sets up a store, camera samples arrive, the dashboard,
 * overview, POS comparison and reports show exactly what was measured — and a store without counting
 * shows "not set up", never zeros.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, resetDb, seedWorld } from './helpers.js';
import { insertSamples } from '../src/services/counting/store.js';
import { addLocalDays, startOfLocalDay, tzParts, zonedToUtc } from '../src/services/counting/time.js';
import type { EngineSample } from '../src/services/counting/engine.js';

const TZ = 'America/Chicago';
let w: Awaited<ReturnType<typeof seedWorld>>;
let day: string;
let zoneIds: Record<string, string>;
let cameraId: string;

function binary(res: any, cb: (err: Error | null, body: Buffer) => void) {
  const c: Buffer[] = [];
  res.on('data', (d: Buffer) => c.push(d));
  res.on('end', () => cb(null, Buffer.concat(c)));
}

beforeAll(async () => {
  await resetDb();
  w = await seedWorld();
  const y = addLocalDays(startOfLocalDay(new Date(), TZ), -1, TZ);
  const p = tzParts(new Date(y.getTime() + 12 * 3600_000), TZ);
  day = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;

  const cam = await api().post(`/api/stores/${w.storeA1}/cameras`).set(w.admin.auth).send({ name: 'Front counter', channel: 2 });
  expect(cam.status).toBe(201);
  cameraId = cam.body.camera.id;
  const sq = (x: number, y: number): Array<[number, number]> => [[x, y], [x + 0.2, y], [x + 0.2, y + 0.2], [x, y + 0.2]];
  const zones = await api().put(`/api/stores/${w.storeA1}/counting/zones`).set(w.admin.auth).send({ zones: [
    { zoneType: 'ENTRY', label: 'Door', audience: 'customer', cameraId, polygon: sq(0, 0) },
    { zoneType: 'QUEUE', label: 'Line', audience: 'customer', cameraId, polygon: sq(0.3, 0) },
    { zoneType: 'REGISTER', label: 'Ordering', audience: 'customer', cameraId, polygon: sq(0.6, 0) },
    { zoneType: 'REGISTER', label: 'Behind counter', audience: 'staff', cameraId, polygon: sq(0.6, 0.5), staffTargetMin: 2, staffTargetMax: 3 },
  ] });
  expect(zones.status).toBe(200);
  zoneIds = Object.fromEntries(zones.body.zones.map((z: { label: string; id: string }) => [z.label, z.id]));
  const prof = await api().put(`/api/stores/${w.storeA1}/counting/profile`).set(w.admin.auth).send({ samplingEnabled: true, sampleIntervalSeconds: 30 });
  expect(prof.status).toBe(200);

  // 10:00-12:00 local yesterday, a round every 30s. A customer arrives every 10 minutes:
  // 1 round at the door, 4 rounds in line (2 min), 2 rounds at the register. One person behind the counter all along.
  const start = zonedToUtc(p.year, p.month, p.day, 10, 0, TZ).getTime();
  const rows: EngineSample[] = [];
  for (let i = 0; i < 240; i++) {
    const at = new Date(start + i * 30_000);
    const k = i % 20;
    const at0 = (zone: string, n: number, pt: [number, number]) => rows.push({ roundAt: at, zoneId: zoneIds[zone], cameraId, count: n, points: n ? [pt] : [] });
    at0('Door', k === 0 ? 1 : 0, [0.1, 0.1]);
    at0('Line', k >= 1 && k <= 4 ? 1 : 0, [0.4, 0.1]);
    at0('Ordering', k >= 5 && k <= 6 ? 1 : 0, [0.7, 0.1]);
    at0('Behind counter', 1, [0.7, 0.6]);
  }
  await insertSamples(w.storeA1, rows);
});

describe('store dashboard', () => {
  it('reports what was measured', async () => {
    const res = await api().get(`/api/stores/${w.storeA1}/insights?range=${day}&hours=all`).set(w.ownerA.auth);
    expect(res.status).toBe(200);
    const m = res.body.metrics;
    expect(m.customersEntered).toMatchObject({ status: 'ok', value: 12 });
    expect(m.waitTime).toMatchObject({ status: 'ok', value: 120 });
    expect(m.counterCoverage).toMatchObject({ status: 'ok', value: 0 });
    // A past day has no "right now": point-in-time numbers say they are the closing value.
    expect(m.lineNow.label).toBe('Line at Closing');
    expect(res.body.dataStatus.live).toBe(false);
    expect(res.body.queue.peak).toBe(1);
    expect(res.body.walkaways ?? m.walkaways.value).toBe(0);
    expect(res.body.dataStatus).toMatchObject({ hasData: true, rounds: 240 });
    const ten = res.body.hourOfDay.find((h: { hour: number }) => h.hour === 10);
    expect(ten).toMatchObject({ entered: 6, waitAvgSeconds: 120, counterCoveragePct: 0 });
  });

  it('a store with no counting areas says so and shows no numbers', async () => {
    const res = await api().get(`/api/stores/${w.storeA2}/insights?range=${day}`).set(w.ownerA.auth);
    expect(res.status).toBe(200);
    expect(res.body.dataStatus.zonesMeasurable).toBe(0);
    for (const k of res.body.kpis) {
      expect(k.value).toBeNull();
      expect(k.status).toBe('needs_zones');
    }
  });
});

describe('overview', () => {
  it('ranks counting stores, totals only measured stores, flags worst hours', async () => {
    const res = await api().get(`/api/overview?range=${day}&hours=all`).set(w.admin.auth);
    expect(res.status).toBe(200);
    const a1 = res.body.stores.find((s: { storeId: string }) => s.storeId === w.storeA1);
    const a2 = res.body.stores.find((s: { storeId: string }) => s.storeId === w.storeA2);
    expect(a1).toMatchObject({ status: 'ok', entered: 12, avgWaitSeconds: 120, counterCoveragePct: 0 });
    expect(a2).toMatchObject({ status: 'not_set_up', entered: null, avgWaitSeconds: null });
    expect(res.body.totals).toMatchObject({ stores: 4, storesCounting: 1, entered: 12, avgWaitSeconds: 120 });
    expect(res.body.worstHours.length).toBeGreaterThan(0);
    expect(res.body.worstHours[0]).toMatchObject({ storeId: w.storeA1 });
    expect(res.body.worstHours[0].reason).toMatch(/counter/);
  });
});

describe('POS comparison', () => {
  it('imports an hourly POS export and matches it to traffic', async () => {
    const csv = `Date,Hour,Net Sales,Orders\n${day},10,100.00,5\n${day},11,"1,200.50",4\n${day},12,50,2\nTotal,,1350.50,11\n`;
    const up = await api().post(`/api/stores/${w.storeA1}/pos-upload`).set(w.admin.auth).send({ csv });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ saved: 3, hours: 3, transactions: 11 });
    const cmp = await api().get(`/api/stores/${w.storeA1}/pos-compare?range=${day}`).set(w.ownerA.auth);
    expect(cmp.status).toBe(200);
    // 10-12 have both traffic (6 + 6) and transactions (5 + 4); noon has POS only and is left out of the rate.
    expect(cmp.body.summary).toMatchObject({ matchedHours: 2, conversionPct: 75, transactions: 11 });
    const ov = await api().get(`/api/overview?range=${day}&hours=all`).set(w.ownerA.auth);
    expect(ov.body.totals).toMatchObject({ transactions: 11, conversionPct: 75 });
  });
});

describe('reports', () => {
  it('store PDF and CSV contain the measured numbers', async () => {
    const pdf = await api().get(`/api/stores/${w.storeA1}/report.pdf?range=${day}&hours=all`).set(w.ownerA.auth).buffer(true).parse(binary);
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    const text = (pdf.body as Buffer).toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('Alpha Downtown');
    const csv = await api().get(`/api/stores/${w.storeA1}/report.csv?range=${day}&hours=all`).set(w.ownerA.auth);
    expect(csv.text).toContain('Customers Entered,12');
    const notSetUp = await api().get(`/api/stores/${w.storeA2}/report.csv?range=${day}`).set(w.ownerA.auth);
    expect(notSetUp.text).toContain('Counting is not set up for this store');
  });
});

describe('settings validation', () => {
  it('refuses areas on a camera from another store', async () => {
    const res = await api().put(`/api/stores/${w.storeB1}/counting/zones`).set(w.admin.auth).send({ zones: [{ zoneType: 'QUEUE', cameraId, polygon: [[0, 0], [1, 0], [1, 1]] }] });
    expect(res.status).toBe(400);
  });

  it('refuses to turn counting on without any areas', async () => {
    const res = await api().put(`/api/stores/${w.storeA2}/counting/profile`).set(w.admin.auth).send({ samplingEnabled: true });
    expect(res.status).toBe(400);
  });

  it('never returns the recorder password', async () => {
    const put = await api().put(`/api/stores/${w.storeA1}/recorder`).set(w.admin.auth).send({ vendor: 'uniview', connection: 'direct', host: '203.0.113.7', rtspPort: 554, username: 'admin', password: 'Sup3r-Secret!' });
    expect(put.status).toBe(200);
    const get = await api().get(`/api/stores/${w.storeA1}/recorder`).set(w.admin.auth);
    expect(get.body.recorder).toMatchObject({ hasPassword: true, host: '203.0.113.7' });
    expect(JSON.stringify(get.body)).not.toContain('Sup3r-Secret!');
  });
});

describe('edge agent', () => {
  it('uses its own store token and can only post to its own cameras', async () => {
    await api().put(`/api/stores/${w.storeA2}/recorder`).set(w.admin.auth).send({ vendor: 'uniview', connection: 'edge' });
    const cam = await api().post(`/api/stores/${w.storeA2}/cameras`).set(w.admin.auth).send({ name: 'Door', channel: 1 });
    const tok = await api().post(`/api/stores/${w.storeA2}/recorder/edge-token`).set(w.admin.auth);
    expect(tok.status).toBe(200);
    const h = { 'X-Edge-Token': tok.body.token };
    const cfg = await api().get('/api/edge/config').set(h);
    expect(cfg.status).toBe(200);
    expect(cfg.body.cameras.map((c: { id: string }) => c.id)).toEqual([cam.body.camera.id]);
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]);
    expect((await api().post(`/api/edge/frames/${cam.body.camera.id}`).set(h).set('Content-Type', 'image/jpeg').send(jpeg)).status).toBe(200);
    // Another store's camera is "not found" for this token.
    expect((await api().post(`/api/edge/frames/${cameraId}`).set(h).set('Content-Type', 'image/jpeg').send(jpeg)).status).toBe(404);
    expect((await api().get('/api/edge/config').set({ 'X-Edge-Token': 'fxe_wrongwrongwrongwrongwrong' })).status).toBe(401);
    // A user session is not an edge token.
    expect((await api().get('/api/edge/config').set(w.admin.auth)).status).toBe(401);
  });
});
