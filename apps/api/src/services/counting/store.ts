/**
 * Counting persistence: per-store profile (overrides), areas (zones) and samples.
 * Callers pass a store that has already been scope-checked (req.store) or comes from a system job.
 */
import { resolveCountingConfig, type CountingConfig, type CountingOverrides, type Zone } from '@foxtail/shared';
import { q, tx } from '../../db/pool.js';
import { newId } from '../../lib/ids.js';
import type { Store } from '../stores.js';
import type { EngineSample } from './engine.js';

type Row = Record<string, unknown>;
const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

function rowToOverrides(r: Row): CountingOverrides {
  return {
    enabledModules: (r.enabled_modules as CountingOverrides['enabledModules']) ?? null,
    kpiMetrics: (r.kpi_metrics as string[]) ?? null,
    enabledRules: (r.enabled_rules as CountingOverrides['enabledRules']) ?? null,
    thresholds: (r.thresholds as CountingOverrides['thresholds']) ?? null,
    samplingEnabled: r.sampling_enabled === true,
    sampleIntervalSeconds: Number(r.sample_interval_seconds ?? 30),
  };
}

export async function getOverrides(storeId: string): Promise<CountingOverrides | null> {
  const r = await q('SELECT * FROM counting_profiles WHERE store_id = $1', [storeId]);
  return r.rows[0] ? rowToOverrides(r.rows[0]) : null;
}

export async function loadConfig(store: Store): Promise<CountingConfig> {
  return resolveCountingConfig(await getOverrides(store.id), store);
}

/** Many stores at once (overview). Missing profile = defaults. */
export async function loadConfigs(stores: Store[]): Promise<Map<string, CountingConfig>> {
  const r = await q('SELECT * FROM counting_profiles WHERE store_id = ANY($1::text[])', [stores.map(s => s.id)]);
  const byId = new Map(r.rows.map(x => [String(x.store_id), rowToOverrides(x)]));
  return new Map(stores.map(s => [s.id, resolveCountingConfig(byId.get(s.id) ?? null, s)]));
}

export async function saveOverrides(storeId: string, o: CountingOverrides, userId: string | null): Promise<CountingOverrides> {
  const r = await q(
    `INSERT INTO counting_profiles (store_id, enabled_modules, kpi_metrics, enabled_rules, thresholds, sampling_enabled, sample_interval_seconds, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
     ON CONFLICT (store_id) DO UPDATE SET enabled_modules=EXCLUDED.enabled_modules, kpi_metrics=EXCLUDED.kpi_metrics, enabled_rules=EXCLUDED.enabled_rules,
       thresholds=EXCLUDED.thresholds, sampling_enabled=EXCLUDED.sampling_enabled, sample_interval_seconds=EXCLUDED.sample_interval_seconds,
       updated_by=EXCLUDED.updated_by, updated_at=NOW()
     RETURNING *`,
    [storeId, j(o.enabledModules), j(o.kpiMetrics), j(o.enabledRules), j(o.thresholds), o.samplingEnabled === true, o.sampleIntervalSeconds ?? 30, userId],
  );
  return rowToOverrides(r.rows[0]);
}

/** Stores with counting switched on (for the sampler). */
export async function samplingStoreIds(): Promise<string[]> {
  const r = await q(`SELECT p.store_id FROM counting_profiles p JOIN stores s ON s.id = p.store_id WHERE p.sampling_enabled AND s.archived_at IS NULL`);
  return r.rows.map(x => String(x.store_id));
}

function rowToZone(r: Row): Zone {
  return {
    id: String(r.id), storeId: String(r.store_id), zoneType: r.zone_type as Zone['zoneType'], label: String(r.label),
    audience: r.audience === 'staff' ? 'staff' : 'customer', cameraId: (r.camera_id as string) ?? null,
    polygon: (r.polygon as Zone['polygon']) ?? null, capacity: r.capacity === null ? null : Number(r.capacity),
    staffTargetMin: r.staff_target_min === null ? null : Number(r.staff_target_min), staffTargetMax: r.staff_target_max === null ? null : Number(r.staff_target_max),
    enabled: r.enabled !== false, sortOrder: Number(r.sort_order ?? 0),
  };
}

export async function getZones(storeId: string): Promise<Zone[]> {
  const r = await q('SELECT * FROM zones WHERE store_id = $1 ORDER BY sort_order, created_at', [storeId]);
  return r.rows.map(rowToZone);
}

export async function getZonesForStores(storeIds: string[]): Promise<Map<string, Zone[]>> {
  const r = await q('SELECT * FROM zones WHERE store_id = ANY($1::text[]) ORDER BY sort_order, created_at', [storeIds]);
  const out = new Map<string, Zone[]>(storeIds.map(id => [id, []]));
  for (const row of r.rows) out.get(String(row.store_id))?.push(rowToZone(row));
  return out;
}

/** Replace a store's areas. Ids are kept when supplied so samples stay linked to their area. */
export async function saveZones(storeId: string, zones: Array<Omit<Zone, 'storeId'>>): Promise<Zone[]> {
  const withIds = zones.map((z, i) => ({ ...z, id: z.id || newId('zn'), sortOrder: z.sortOrder ?? i }));
  await tx(async c => {
    await c.query('DELETE FROM zones WHERE store_id = $1 AND NOT (id = ANY($2::text[]))', [storeId, withIds.map(z => z.id)]);
    for (const z of withIds) {
      // ON CONFLICT ... WHERE keeps an id from another store from being taken over.
      const r = await c.query(
        `INSERT INTO zones (id, store_id, zone_type, label, audience, camera_id, polygon, capacity, staff_target_min, staff_target_max, enabled, sort_order, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
         ON CONFLICT (id) DO UPDATE SET zone_type=EXCLUDED.zone_type, label=EXCLUDED.label, audience=EXCLUDED.audience, camera_id=EXCLUDED.camera_id,
           polygon=EXCLUDED.polygon, capacity=EXCLUDED.capacity, staff_target_min=EXCLUDED.staff_target_min, staff_target_max=EXCLUDED.staff_target_max,
           enabled=EXCLUDED.enabled, sort_order=EXCLUDED.sort_order, updated_at=NOW()
         WHERE zones.store_id = EXCLUDED.store_id`,
        [z.id, storeId, z.zoneType, z.label, z.audience, z.cameraId, j(z.polygon), z.capacity, z.staffTargetMin, z.staffTargetMax, z.enabled, z.sortOrder],
      );
      if (!r.rowCount) throw Object.assign(new Error(`Area id ${z.id} belongs to another store`), { status: 400 });
    }
  });
  return getZones(storeId);
}

export async function insertSamples(storeId: string, rows: EngineSample[]): Promise<void> {
  if (!rows.length) return;
  const vals: unknown[] = [];
  const ph: string[] = [];
  rows.forEach((r, i) => {
    const b = i * 6;
    ph.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6})`);
    vals.push(storeId, r.roundAt, r.zoneId, r.cameraId, r.count, j(r.points));
  });
  await q(`INSERT INTO samples (store_id, round_at, zone_id, camera_id, person_count, points) VALUES ${ph.join(',')}`, vals);
}

export async function querySamples(storeId: string, start: Date, end: Date): Promise<EngineSample[]> {
  const r = await q(
    'SELECT round_at, zone_id, camera_id, person_count, points FROM samples WHERE store_id = $1 AND round_at >= $2 AND round_at <= $3 ORDER BY round_at',
    [storeId, start, end],
  );
  return r.rows.map(x => ({ roundAt: new Date(x.round_at as string), zoneId: String(x.zone_id), cameraId: (x.camera_id as string) ?? null, count: Number(x.person_count), points: (x.points as Array<[number, number]>) ?? null }));
}

export async function lastSampleAt(storeIds: string[]): Promise<Map<string, Date>> {
  if (!storeIds.length) return new Map();
  const r = await q('SELECT store_id, MAX(round_at) AS last FROM samples WHERE store_id = ANY($1::text[]) GROUP BY store_id', [storeIds]);
  return new Map(r.rows.map(x => [String(x.store_id), new Date(x.last as string)]));
}

/** Numbers are kept long (180 days by default) so stores can compare month over month and against POS. */
export async function cleanupSamples(days = Number(process.env.SAMPLE_RETENTION_DAYS || 180)): Promise<void> {
  await q('DELETE FROM samples WHERE round_at < $1', [new Date(Date.now() - days * 86400_000)]);
}
