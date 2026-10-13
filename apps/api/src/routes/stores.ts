/**
 * Stores. Everything under /api/stores/:storeId goes through storeParam (middleware/store-scope.ts):
 * a store outside the login's scope is a 404 before any handler runs.
 *
 * Read (any role, own stores only):
 *   GET  /api/stores                                   stores in scope + counting status
 *   GET  /api/stores/:storeId                          store details
 *   GET  /api/stores/:storeId/insights                 dashboard ?range=&hours=
 *   GET  /api/stores/:storeId/report.pdf|report.csv|hourly.csv
 *   GET  /api/stores/:storeId/pos-compare(.csv)        traffic vs register sales ?range=
 *   GET  /api/stores/:storeId/cameras                  cameras + last known online/offline status
 *   GET  /api/stores/:storeId/cameras/:id/picture.jpg  latest picture (cached ~20 s)
 *   GET  /api/stores/:storeId/cameras/:id/live/index.m3u8 (+ segments)  live video, on demand
 * Corporate (admin + viewer):
 *   GET  /api/stores/:storeId/recorder | counting | accuracy
 * Corporate admin only (settings):
 *   POST /api/stores, PATCH|DELETE /api/stores/:storeId
 *   PUT  /recorder, POST /recorder/test, POST /recorder/edge-token
 *   POST /cameras, PATCH|DELETE /cameras/:cameraId, GET /cameras/:cameraId/frame.jpg
 *   PUT  /counting/profile, PUT /counting/zones, POST /counting/test
 *   POST /api/imports/ezcloud-channels                 real stores + cameras from the EZCloud export
 *   POST /pos-upload, DELETE /pos/:date, POST|DELETE /accuracy
 */
import { Router, type Request } from 'express';
import {
  isValidTimezone, validateCountingOverrides, validateHours, validateZones, DEFAULT_HOURS, DEFAULT_TIMEZONE,
  RECORDER_CONNECTIONS, RECORDER_VENDORS, ZONE_TYPE_DEFS, ZONE_TYPES, METRICS, MODULES, MODULE_LABELS, RULES, RULE_LABELS,
  THRESHOLD_LABELS, THRESHOLD_LIMITS, DEFAULT_THRESHOLDS, SUGGESTED_ZONES, VENDOR_LABELS,
  type RecorderConnection, type RecorderVendor,
} from '@foxtail/shared';
import { q } from '../db/pool.js';
import { badRequest, conflict, HttpError, notFound, str } from '../lib/http.js';
import { newId } from '../lib/ids.js';
import { requireCorporate, requireManager } from '../middleware/auth.js';
import { storeParam, theStore } from '../middleware/store-scope.js';
import { audit } from '../services/audit.js';
import { listScopedStores, scopedStore, type Store } from '../services/stores.js';
import { countingSetup } from '../services/overview.js';
import * as countingStore from '../services/counting/store.js';
import { clearInsightsCache, hoursLabel, parseRange, RANGE_HELP, storeInsights } from '../services/counting/insights.js';
import { detectForCamera, invalidateSampler, samplerStatus } from '../services/counting/sampler.js';
import { detectorConfigured } from '../services/counting/detector.js';
import { parsePosCsv } from '../services/counting/pos-csv.js';
import * as pos from '../services/counting/pos.js';
import * as accuracy from '../services/counting/accuracy.js';
import { addLocalDays, zonedToUtc } from '../services/counting/time.js';
import * as recorders from '../services/recorders/recorders.js';
import { grabFrame, PROBE_HINTS, probeRtsp, probeUrlFor } from '../services/recorders/capture.js';
import { storeCsv, storeHourlyCsv, storePdf } from '../services/reports/store-report.js';
import { slug } from '../services/reports/pdf.js';
import { livePlaylist, liveSegment } from '../services/video/live.js';
import { importChannelExport } from '../services/inventory/ezcloud-import.js';

const router = Router();
router.param('storeId', storeParam);

function storeView(s: Store) {
  return {
    id: s.id, storeNumber: s.storeNumber, name: s.name, address: s.address, city: s.city, state: s.state, postalCode: s.postalCode,
    timezone: s.timezone, openingHours: s.openingHours, franchiseeId: s.franchiseeId, franchiseeName: s.franchiseeName,
    sourceDeviceName: s.sourceDeviceName, recorderModel: s.recorderModel,
  };
}

// ------------------------------------------------------------------------------------- list / create

router.get('/stores', async (req, res) => {
  const stores = await listScopedStores(req.auth!);
  const [setup, last] = await Promise.all([countingSetup(stores.map(s => s.id)), countingStore.lastSampleAt(stores.map(s => s.id))]);
  const r = await q('SELECT store_id, sampling_enabled FROM counting_profiles WHERE store_id = ANY($1::text[])', [stores.map(s => s.id)]);
  const on = new Map(r.rows.map(x => [String(x.store_id), x.sampling_enabled === true]));
  const camRows = await q(
    `SELECT c.store_id, COUNT(*)::int AS total, COUNT(*) FILTER (WHERE c.status = 'online')::int AS online, COUNT(*) FILTER (WHERE c.status = 'offline')::int AS offline,
            MAX(c.status_at) AS status_at
       FROM cameras c WHERE c.store_id = ANY($1::text[]) AND c.enabled GROUP BY c.store_id`, [stores.map(s => s.id)]);
  const cams = new Map(camRows.rows.map(x => [String(x.store_id), { total: Number(x.total), online: Number(x.online), offline: Number(x.offline), statusAt: x.status_at ? new Date(x.status_at as string).toISOString() : null }]));
  const recs = await q(`SELECT store_id, connection, host IS NOT NULL AND username IS NOT NULL AND password_sealed IS NOT NULL AS complete FROM recorders WHERE store_id = ANY($1::text[])`, [stores.map(s => s.id)]);
  const video = new Map(recs.rows.map(x => [String(x.store_id), x.connection === 'edge' ? 'pictures' : x.complete ? 'live' : 'none']));
  res.json({
    stores: stores.map(s => ({
      ...storeView(s),
      counting: { areas: setup.get(s.id)?.areas ?? 0, measurable: setup.get(s.id)?.measurable ?? 0, enabled: on.get(s.id) ?? false, lastSampleAt: last.get(s.id)?.toISOString() ?? null },
      cameras: { ...(cams.get(s.id) ?? { total: 0, online: 0, offline: 0, statusAt: null }), video: video.get(s.id) ?? 'none' },
    })),
  });
});

async function storeFields(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (!partial || has('name')) {
    const name = str(body.name, 120);
    if (!name) throw badRequest('Store name is required.');
    out.name = name;
  }
  for (const [k, col, max] of [['storeNumber', 'store_number', 20], ['address', 'address', 200], ['city', 'city', 80], ['state', 'state', 40], ['postalCode', 'postal_code', 20]] as const) {
    if (!partial || has(k)) out[col] = str(body[k], max);
  }
  if (!partial || has('timezone')) {
    const tz = body.timezone ?? DEFAULT_TIMEZONE;
    if (!isValidTimezone(tz)) throw badRequest('Time zone is not valid (use a name like America/Chicago).');
    out.timezone = tz;
  }
  if (!partial || has('openingHours')) {
    const v = validateHours(body.openingHours ?? DEFAULT_HOURS);
    if (!v.ok) throw badRequest(v.errors.join('; '), v.errors);
    out.opening_hours = JSON.stringify(v.value);
  }
  if (!partial || has('franchiseeId')) {
    const fid = str(body.franchiseeId, 64);
    if (fid) {
      const r = await q('SELECT 1 FROM franchisees WHERE id = $1', [fid]);
      if (!r.rowCount) throw badRequest('That franchisee does not exist.');
    }
    out.franchisee_id = fid;
  }
  return out;
}

function uniqueViolation(err: unknown): boolean { return (err as { code?: string })?.code === '23505'; }

router.post('/stores', requireManager, async (req, res) => {
  const f = await storeFields(req.body || {}, false);
  const id = newId('st');
  const cols = ['id', ...Object.keys(f)];
  try {
    await q(`INSERT INTO stores (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, [id, ...Object.values(f)]);
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('Another store already has that store number.');
    throw err;
  }
  await audit(req.auth!.user.id, 'store.created', id, { name: f.name, franchiseeId: f.franchisee_id });
  res.status(201).json({ store: storeView((await scopedStore(req.auth!, id))!) });
});

// ------------------------------------------------------------------------------------- one store

router.get('/stores/:storeId', async (req, res) => {
  res.json({ store: storeView(theStore(req)) });
});

router.patch('/stores/:storeId', requireManager, async (req, res) => {
  const store = theStore(req);
  const f = await storeFields(req.body || {}, true);
  if (Object.keys(f).length) {
    const sets = Object.keys(f).map((c, i) => `${c} = $${i + 2}`);
    try {
      await q(`UPDATE stores SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, [store.id, ...Object.values(f)]);
    } catch (err) {
      if (uniqueViolation(err)) throw conflict('Another store already has that store number.');
      throw err;
    }
  }
  clearInsightsCache(store.id);
  invalidateSampler();
  await audit(req.auth!.user.id, 'store.updated', store.id, { fields: Object.keys(f) });
  res.json({ store: storeView((await scopedStore(req.auth!, store.id))!) });
});

/** Archive: the store disappears from every list and its counting stops; its numbers are kept. */
router.delete('/stores/:storeId', requireManager, async (req, res) => {
  const store = theStore(req);
  await q('UPDATE stores SET archived_at = NOW(), updated_at = NOW() WHERE id = $1', [store.id]);
  await q('UPDATE counting_profiles SET sampling_enabled = FALSE WHERE store_id = $1', [store.id]);
  invalidateSampler();
  await audit(req.auth!.user.id, 'store.archived', store.id, { name: store.name });
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------- dashboard

router.get('/stores/:storeId/insights', async (req, res) => {
  const store = theStore(req);
  const out = await storeInsights(store, req.query.range, req.query.hours);
  if ('error' in out) throw badRequest(out.error);
  res.json({ store: storeView(store), hoursLabel: hoursLabel(out.hours), config: { kpis: out.cfg.kpis.map(k => k.key), modules: out.cfg.modules, thresholds: out.cfg.thresholds, terms: out.cfg.terms }, ...out.result });
});

async function reportFor(req: Request, kind: 'pdf' | 'csv' | 'hourly') {
  const store = theStore(req);
  const out = await storeInsights(store, req.query.range, req.query.hours);
  if ('error' in out) throw badRequest(out.error);
  const meta = { store, generatedAt: new Date(), hoursLabel: hoursLabel(out.hours) };
  const day = out.range.start.toLocaleDateString('en-CA', { timeZone: out.cfg.timezone });
  const base = `foxtail-${kind === 'hourly' ? 'hourly' : 'report'}-${slug(store.name)}-${day}${out.range.singleDay ? '' : `-${out.range.key.replace(/[^0-9a-z]+/gi, '-')}`}`;
  if (kind === 'pdf') return { body: storePdf(out.result, meta), type: 'application/pdf', filename: `${base}.pdf` };
  return { body: kind === 'csv' ? storeCsv(out.result, meta) : storeHourlyCsv(out.result, meta), type: 'text/csv; charset=utf-8', filename: `${base}.csv` };
}

for (const [path, kind] of [['report.pdf', 'pdf'], ['report.csv', 'csv'], ['hourly.csv', 'hourly']] as const) {
  router.get(`/stores/:storeId/${path}`, async (req, res) => {
    const r = await reportFor(req, kind);
    res.setHeader('Content-Disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.type(r.type).send(r.body);
  });
}

// ------------------------------------------------------------------------------------- POS

async function comparison(req: Request) {
  const store = theStore(req);
  const cfg = await countingStore.loadConfig(store);
  const range = parseRange(req.query.range || '7d', cfg.timezone, new Date());
  if (!range) throw badRequest(RANGE_HELP);
  const zones = await countingStore.getZones(store.id);
  const rows = await pos.hourlyComparison(store.id, cfg, zones, range.start, new Date(range.end.getTime() + 1));
  return { store, cfg, range, rows, summary: pos.summarize(rows) };
}

router.get('/stores/:storeId/pos-compare', async (req, res) => {
  const c = await comparison(req);
  res.json({
    range: { key: c.range.key, label: c.range.label, start: c.range.start, end: c.range.end }, timezone: c.cfg.timezone,
    summary: c.summary, rows: c.rows, uploads: await pos.posUploads(c.store.id, c.cfg.timezone),
  });
});

router.get('/stores/:storeId/pos-compare.csv', async (req, res) => {
  const c = await comparison(req);
  res.setHeader('Content-Disposition', `attachment; filename="foxtail-traffic-vs-sales-${slug(c.store.name)}-${c.range.key.replace(/[^0-9a-z]+/gi, '-')}.csv"`);
  res.type('text/csv; charset=utf-8').send(pos.comparisonCsv(c.rows, c.store.name));
});

router.post('/stores/:storeId/pos-upload', requireManager, async (req, res) => {
  const store = theStore(req);
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) throw badRequest('Choose a CSV file.');
  if (csv.length > 6_000_000) throw badRequest('File is too large (max 6 MB).');
  const date = typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date) ? req.body.date : null;
  const cfg = await countingStore.loadConfig(store);
  const parsed = parsePosCsv(csv, cfg.timezone, date);
  if ('error' in parsed) throw badRequest(parsed.error);
  const now = Date.now();
  const rows = parsed.rows.filter(r => r.hourAt.getTime() <= now && r.hourAt.getTime() > now - 400 * 86400_000);
  if (rows.length < parsed.rows.length) parsed.warnings.push(`${parsed.rows.length - rows.length} hour(s) in the future or older than 400 days were ignored.`);
  if (!rows.length) throw badRequest('No usable hours in this file.');
  const dryRun = req.body?.dryRun === true;
  const saved = dryRun ? 0 : await pos.upsertPos(store.id, rows, parsed.source, req.auth!.user.id);
  if (!dryRun) await audit(req.auth!.user.id, 'pos.uploaded', store.id, { hours: rows.length, source: parsed.source });
  const days = [...new Set(rows.map(r => r.hourAt.toLocaleDateString('en-CA', { timeZone: cfg.timezone })))].sort();
  res.json({
    saved, dryRun, source: parsed.source, shape: parsed.shape, warnings: parsed.warnings, days, hours: rows.length,
    sales: Math.round(rows.reduce((a, r) => a + (r.sales ?? 0), 0) * 100) / 100, transactions: rows.reduce((a, r) => a + (r.transactions ?? 0), 0),
  });
});

router.delete('/stores/:storeId/pos/:date', requireManager, async (req, res) => {
  const store = theStore(req);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.params.date));
  if (!m) throw badRequest('date must be YYYY-MM-DD');
  const s0 = zonedToUtc(+m[1], +m[2], +m[3], 0, 0, store.timezone);
  const deleted = await pos.deletePosDay(store.id, s0, addLocalDays(s0, 1, store.timezone));
  await audit(req.auth!.user.id, 'pos.deleted', store.id, { date: req.params.date, hours: deleted });
  res.json({ deleted });
});

// ------------------------------------------------------------------------------------- accuracy checks

router.get('/stores/:storeId/accuracy', requireCorporate, async (req, res) => {
  const store = theStore(req);
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 90));
  const checks = await accuracy.listChecks(store.id, new Date(Date.now() - days * 86400_000));
  res.json({ targets: { countPct: accuracy.COUNT_TARGET_PCT, waitSeconds: accuracy.WAIT_TARGET_SEC }, summary: accuracy.accuracySummary(checks), checks });
});

router.post('/stores/:storeId/accuracy', requireManager, async (req, res) => {
  const store = theStore(req);
  const b = req.body || {};
  const kind = b.kind === 'wait' ? 'wait' : b.kind === 'count' ? 'count' : null;
  const startAt = new Date(String(b.startAt || ''));
  const minutes = Math.round(Number(b.minutes));
  const manualValue = Number(b.manualValue);
  const manualN = b.manualN === undefined || b.manualN === null || b.manualN === '' ? null : Math.round(Number(b.manualN));
  if (!kind) throw badRequest('kind must be count or wait');
  if (Number.isNaN(startAt.getTime())) throw badRequest('startAt must be a date and time');
  if (!(minutes > 0 && minutes <= 240)) throw badRequest('minutes must be 1 to 240');
  if (!Number.isFinite(manualValue) || manualValue < 0) throw badRequest('manualValue must be a number');
  const end = new Date(startAt.getTime() + minutes * 60_000);
  if (end.getTime() > Date.now() + 60_000) throw badRequest('The check window has not finished yet');
  const cfg = await countingStore.loadConfig(store);
  const zones = await countingStore.getZones(store.id);
  const m = await accuracy.measureWindow(store.id, cfg, zones, startAt, end);
  const check = await accuracy.addCheck(store.id, { kind, startAt, minutes, manualValue, manualN: manualN !== null && Number.isFinite(manualN) ? manualN : null, notes: String(b.notes || '') }, m, req.auth!.user.id);
  res.status(201).json({ check });
});

router.delete('/stores/:storeId/accuracy/:checkId', requireManager, async (req, res) => {
  const ok = await accuracy.deleteCheck(theStore(req).id, String(req.params.checkId));
  if (!ok) throw notFound();
  res.json({ ok: true });
});

// ------------------------------------------------------------------------------------- recorder

router.get('/stores/:storeId/recorder', requireCorporate, async (req, res) => {
  const store = theStore(req);
  res.json({ recorder: await recorders.getRecorder(store.id), vendors: RECORDER_VENDORS.map(v => ({ key: v, label: VENDOR_LABELS[v] })) });
});

router.put('/stores/:storeId/recorder', requireManager, async (req, res) => {
  const store = theStore(req);
  const b = req.body || {};
  if (!(RECORDER_VENDORS as readonly string[]).includes(b.vendor)) throw badRequest('Pick the recorder brand.');
  if (!(RECORDER_CONNECTIONS as readonly string[]).includes(b.connection)) throw badRequest('Pick how the recorder connects (direct or edge agent).');
  const host = str(b.host, 200);
  if (host && !/^[A-Za-z0-9.\-:[\]]+$/.test(host)) throw badRequest('Recorder address should be a host name or IP address only (no rtsp://, no path).');
  const port = b.rtspPort === undefined || b.rtspPort === null || b.rtspPort === '' ? null : Number(b.rtspPort);
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw badRequest('RTSP port must be 1-65535.');
  if (b.connection === 'direct' && !host) throw badRequest('A direct connection needs the recorder address.');
  const pathTemplate = b.vendor === 'custom' ? str(b.pathTemplate, 200) : null;
  if (b.vendor === 'custom' && !pathTemplate) throw badRequest('A custom recorder needs a stream path, e.g. /live/{ch}.');
  const password = b.password === undefined || b.password === null ? undefined : String(b.password).slice(0, 200);
  const rec = await recorders.saveRecorder(store.id, {
    vendor: b.vendor as RecorderVendor, connection: b.connection as RecorderConnection, host, rtspPort: port, username: str(b.username, 100),
    password, pathTemplate, streamProfile: b.streamProfile === 'main' ? 'main' : 'sub',
  });
  await audit(req.auth!.user.id, 'recorder.saved', store.id, { vendor: rec.vendor, connection: rec.connection, host: rec.host, passwordChanged: password !== undefined });
  res.json({ recorder: rec });
});

router.post('/stores/:storeId/recorder/test', requireManager, async (req, res) => {
  const store = theStore(req);
  const rec = await recorders.getRecorder(store.id);
  if (!rec) throw badRequest('Save the recorder first.');
  if (rec.connection === 'edge') {
    const fresh = rec.edgeLastSeenAt && Date.now() - new Date(rec.edgeLastSeenAt).getTime() < 3 * 60_000;
    res.json({ ok: !!fresh, connection: 'edge', message: fresh ? 'The edge agent is connected.' : rec.edgeLastSeenAt ? `The edge agent was last seen ${new Date(rec.edgeLastSeenAt).toLocaleString('en-US', { timeZone: store.timezone })}.` : 'The edge agent has not connected yet.' });
    return;
  }
  const cams = await recorders.listCameras(store.id);
  const channel = Number(req.body?.channel) || cams[0]?.channel || 1;
  const url = await probeUrlFor(store.id, channel);
  if (!url) throw badRequest('The recorder address, username or password is missing.');
  const p = await probeRtsp(url);
  await recorders.recordTest(store.id, p.ok, p.ok ? null : (p.error || 'Failed'));
  res.json({ ok: p.ok, connection: 'direct', channel, codec: p.codec ?? null, width: p.width ?? null, height: p.height ?? null, message: p.ok ? `Channel ${channel} streams ${p.codec} ${p.width}×${p.height}.` : PROBE_HINTS[p.errorClass || 'unknown'], detail: p.error ?? null });
});

router.post('/stores/:storeId/recorder/edge-token', requireManager, async (req, res) => {
  const store = theStore(req);
  const rec = await recorders.getRecorder(store.id);
  if (!rec || rec.connection !== 'edge') throw badRequest('Set the recorder connection to "edge agent" and save first.');
  const token = await recorders.rotateEdgeToken(store.id);
  await audit(req.auth!.user.id, 'recorder.edge_token_issued', store.id, {});
  res.json({ token });
});

// ------------------------------------------------------------------------------------- cameras

/** How a store's cameras can be watched: live video (direct recorder), pictures only (edge agent), or not yet. */
async function videoMode(storeId: string): Promise<{ mode: 'live' | 'pictures' | 'none'; reason: string | null }> {
  const rec = await recorders.getRecorder(storeId);
  if (!rec) return { mode: 'none', reason: 'Add this store\'s recorder address and login (Settings → Recorder & cameras) to watch its cameras.' };
  if (rec.connection === 'edge') return { mode: 'pictures', reason: 'This store connects through the edge agent: Foxtail shows the latest pictures it sends, not continuous video.' };
  if (!rec.host || !rec.username || !rec.hasPassword) return { mode: 'none', reason: 'The recorder address, username or password is missing.' };
  return { mode: 'live', reason: null };
}

/** Cameras with their last known status. Any login that can see the store can see its cameras. */
router.get('/stores/:storeId/cameras', async (req, res) => {
  const store = theStore(req);
  const [cameras, video] = await Promise.all([recorders.listCameras(store.id), videoMode(store.id)]);
  res.json({ cameras, video, recorderModel: store.recorderModel });
});

function cameraFields(b: Record<string, unknown>, partial: boolean) {
  const name = str(b.name, 80);
  const channel = b.channel === undefined ? undefined : Number(b.channel);
  if (!partial && !name) throw badRequest('Camera name is required.');
  if ((!partial || channel !== undefined) && (!Number.isInteger(channel) || channel! < 1 || channel! > 256)) throw badRequest('Channel must be 1-256.');
  return { name: name ?? undefined, channel, enabled: typeof b.enabled === 'boolean' ? b.enabled : undefined };
}

router.post('/stores/:storeId/cameras', requireManager, async (req, res) => {
  const store = theStore(req);
  const f = cameraFields(req.body || {}, false);
  try {
    const cam = await recorders.addCamera(store.id, f.name!, f.channel!);
    await audit(req.auth!.user.id, 'camera.added', store.id, { cameraId: cam.id, channel: cam.channel });
    res.status(201).json({ camera: cam });
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('This store already has a camera on that channel.');
    throw err;
  }
});

router.patch('/stores/:storeId/cameras/:cameraId', requireManager, async (req, res) => {
  const store = theStore(req);
  try {
    const cam = await recorders.updateCamera(store.id, String(req.params.cameraId), cameraFields(req.body || {}, true));
    if (!cam) throw notFound('Camera not found');
    res.json({ camera: cam });
  } catch (err) {
    if (uniqueViolation(err)) throw conflict('This store already has a camera on that channel.');
    throw err;
  }
});

router.delete('/stores/:storeId/cameras/:cameraId', requireManager, async (req, res) => {
  const store = theStore(req);
  if (!(await recorders.deleteCamera(store.id, String(req.params.cameraId)))) throw notFound('Camera not found');
  await audit(req.auth!.user.id, 'camera.removed', store.id, { cameraId: req.params.cameraId });
  res.json({ ok: true });
});

/** A live picture for drawing counting areas (admins only; never stored). */
router.get('/stores/:storeId/cameras/:cameraId/frame.jpg', requireManager, async (req, res) => {
  const store = theStore(req);
  const cam = await recorders.getCamera(store.id, String(req.params.cameraId));
  if (!cam) throw notFound('Camera not found');
  const f = await grabFrame(store.id, cam);
  if (!f.ok || !f.jpeg) throw new HttpError(502, 'NO_FRAME', f.error || 'Could not get a picture from this camera right now');
  res.setHeader('Cache-Control', 'no-store');
  res.type('image/jpeg').send(f.jpeg);
});

// ------------------------------------------------------------------------------------- watching cameras

// A wall of tiles must not open one recorder connection per tile every few seconds: share pictures for 20 s.
const pictureCache = new Map<string, { at: number; jpeg: Buffer | null; error: string | null }>();
const pictureInflight = new Map<string, Promise<{ jpeg: Buffer | null; error: string | null }>>();

/** The latest picture from a camera (cached ~20 s, never stored). Same access as the store. */
router.get('/stores/:storeId/cameras/:cameraId/picture.jpg', async (req, res) => {
  const store = theStore(req);
  const cam = await recorders.getCamera(store.id, String(req.params.cameraId));
  if (!cam) throw notFound('Camera not found');
  const hit = pictureCache.get(cam.id);
  let pic: { jpeg: Buffer | null; error: string | null };
  if (hit && Date.now() - hit.at < 20_000) pic = hit;
  else {
    let p = pictureInflight.get(cam.id);
    if (!p) {
      p = grabFrame(store.id, cam).then(async f => {
        const out = { jpeg: f.ok && f.jpeg ? f.jpeg : null, error: f.ok ? null : f.error || 'No picture' };
        pictureCache.set(cam.id, { at: Date.now(), ...out });
        if (pictureCache.size > 2000) pictureCache.delete(pictureCache.keys().next().value as string);
        const rec = await recorders.getRecorder(store.id);
        // Only "online/offline" when Foxtail actually tried the recorder (not when no recorder is set up).
        if (rec && (rec.connection === 'direct' || out.jpeg)) await recorders.setCameraStatus(cam.id, out.jpeg ? 'online' : 'offline').catch(() => {});
        return out;
      }).finally(() => pictureInflight.delete(cam.id));
      pictureInflight.set(cam.id, p);
    }
    pic = await p;
  }
  if (!pic.jpeg) throw new HttpError(502, 'NO_PICTURE', pic.error || 'No picture from this camera right now');
  res.setHeader('Cache-Control', 'private, max-age=15');
  res.type('image/jpeg').send(pic.jpeg);
});

/** Live video playlist (HLS). Starts the camera's stream on first request; stops when nobody watches. */
router.get('/stores/:storeId/cameras/:cameraId/live/index.m3u8', async (req, res) => {
  const store = theStore(req);
  const cam = await recorders.getCamera(store.id, String(req.params.cameraId));
  if (!cam) throw notFound('Camera not found');
  const v = await videoMode(store.id);
  if (v.mode !== 'live') throw new HttpError(409, 'NO_LIVE_VIDEO', v.reason || 'Live video is not available for this store');
  const url = await probeUrlFor(store.id, cam.channel);
  if (!url) throw new HttpError(409, 'NO_LIVE_VIDEO', 'The recorder login is incomplete.');
  const out = await livePlaylist(cam, url);
  if (!out.ok) throw new HttpError(out.state === 'starting' ? 503 : 502, `LIVE_${out.state.toUpperCase().replace(/-/g, '_')}`, out.message, out.detail ? { detail: out.detail } : undefined);
  res.setHeader('Cache-Control', 'no-store');
  res.type('application/vnd.apple.mpegurl').send(out.body);
});

router.get('/stores/:storeId/cameras/:cameraId/live/:segment', async (req, res) => {
  const store = theStore(req);
  const cam = await recorders.getCamera(store.id, String(req.params.cameraId));
  if (!cam) throw notFound('Camera not found');
  const seg = liveSegment(cam.id, String(req.params.segment));
  if (!seg) throw notFound('Segment not found');
  res.setHeader('Cache-Control', 'no-store');
  res.type('video/mp2t').send(seg);
});

// ------------------------------------------------------------------------------------- import real inventory

/** EZCloud "Channel Management" export -> stores + cameras (corporate admin). dryRun previews it. */
router.post('/imports/ezcloud-channels', requireManager, async (req, res) => {
  const csv = typeof req.body?.csv === 'string' ? req.body.csv : '';
  if (!csv.trim()) throw badRequest('Choose the EZCloud Channel Management export (CSV).');
  if (csv.length > 8_000_000) throw badRequest('File is too large (max 8 MB).');
  const out = await importChannelExport(csv, { dryRun: req.body?.dryRun === true });
  if ('error' in out) throw badRequest(out.error);
  if (!out.dryRun) await audit(req.auth!.user.id, 'inventory.ezcloud_import', null, { storesCreated: out.storesCreated, storesUpdated: out.storesUpdated, camerasCreated: out.camerasCreated, camerasUpdated: out.camerasUpdated });
  res.json(out);
});

// ------------------------------------------------------------------------------------- counting setup

router.get('/stores/:storeId/counting', requireCorporate, async (req, res) => {
  const store = theStore(req);
  const [overrides, zones, cameras] = await Promise.all([countingStore.getOverrides(store.id), countingStore.getZones(store.id), recorders.listCameras(store.id)]);
  const cfg = await countingStore.loadConfig(store);
  res.json({
    overrides, config: { kpis: cfg.kpis.map(k => k.key), modules: cfg.modules, rules: cfg.rules, thresholds: cfg.thresholds, samplingEnabled: cfg.samplingEnabled, sampleIntervalSeconds: cfg.sampleIntervalSeconds },
    zones, cameras, sampler: samplerStatus(store.id), detector: { configured: detectorConfigured() },
    catalog: {
      zoneTypes: ZONE_TYPES.map(t => ZONE_TYPE_DEFS[t]), suggestedZones: SUGGESTED_ZONES,
      metrics: Object.values(METRICS).map(m => ({ key: m.key, label: m.label, description: m.description, module: m.module })),
      modules: MODULES.map(m => ({ key: m, label: MODULE_LABELS[m] })), rules: RULES.map(r => ({ key: r, label: RULE_LABELS[r] })),
      thresholds: Object.keys(DEFAULT_THRESHOLDS).map(k => ({ key: k, label: THRESHOLD_LABELS[k as keyof typeof THRESHOLD_LABELS], default: DEFAULT_THRESHOLDS[k as keyof typeof DEFAULT_THRESHOLDS], limits: THRESHOLD_LIMITS[k as keyof typeof THRESHOLD_LIMITS] })),
    },
  });
});

router.put('/stores/:storeId/counting/profile', requireManager, async (req, res) => {
  const store = theStore(req);
  const v = validateCountingOverrides(req.body);
  if (!v.ok) throw badRequest(v.errors.join('; '), v.errors);
  if (v.value.samplingEnabled) {
    const zones = await countingStore.getZones(store.id);
    if (!zones.some(z => z.enabled && z.cameraId && z.polygon && z.polygon.length >= 3)) throw badRequest('Draw at least one counting area on a camera before turning counting on.');
  }
  const saved = await countingStore.saveOverrides(store.id, v.value, req.auth!.user.id);
  invalidateSampler();
  clearInsightsCache(store.id);
  await audit(req.auth!.user.id, 'counting.profile_saved', store.id, { samplingEnabled: saved.samplingEnabled, kpis: saved.kpiMetrics, thresholds: saved.thresholds });
  res.json({ overrides: saved });
});

router.put('/stores/:storeId/counting/zones', requireManager, async (req, res) => {
  const store = theStore(req);
  const v = validateZones(req.body?.zones ?? req.body);
  if (!v.ok) throw badRequest(v.errors.join('; '), v.errors);
  const cams = new Set((await recorders.listCameras(store.id)).map(c => c.id));
  for (const z of v.value) if (z.cameraId && !cams.has(z.cameraId)) throw badRequest(`Area "${z.label}" uses a camera that is not at this store.`);
  let zones;
  try {
    zones = await countingStore.saveZones(store.id, v.value);
  } catch (err) {
    if ((err as { status?: number }).status === 400) throw badRequest((err as Error).message);
    throw err;
  }
  clearInsightsCache(store.id);
  await audit(req.auth!.user.id, 'counting.zones_saved', store.id, { areas: zones.length });
  res.json({ zones });
});

/** One-off picture + person detection on a camera with the given (draft) areas. Nothing is stored. */
router.post('/stores/:storeId/counting/test', requireManager, async (req, res) => {
  const store = theStore(req);
  const cam = await recorders.getCamera(store.id, String(req.body?.cameraId || ''));
  if (!cam) throw badRequest('Pick a camera at this store.');
  if (!detectorConfigured()) throw new HttpError(409, 'DETECTOR_OFF', 'Person detection is not configured on this server.');
  let zones = await countingStore.getZones(store.id);
  if (req.body?.zones) {
    const v = validateZones(req.body.zones);
    if (!v.ok) throw badRequest(v.errors.join('; '));
    zones = v.value.map((z, i) => ({ ...z, id: z.id || `draft_${i}`, storeId: store.id }));
  }
  const r = await detectForCamera(store.id, cam, zones.filter(z => z.enabled));
  res.json({
    ok: r.ok, error: r.error, width: r.width, height: r.height,
    people: r.boxes.map(b => ({ x: r.width ? (b.x - b.width / 2) / r.width : 0, y: r.height ? (b.y - b.height / 2) / r.height : 0, w: r.width ? b.width / r.width : 0, h: r.height ? b.height / r.height : 0, confidence: Math.round(b.confidence * 100) / 100 })),
    zones: [...r.zoneCounts.entries()].map(([zoneId, pts]) => ({ zoneId, label: zones.find(z => z.id === zoneId)?.label ?? zoneId, count: pts.length })),
    imageBase64: r.jpeg ? r.jpeg.toString('base64') : null,
  });
});

export default router;
