/**
 * Demo site (DEMO_MODE=true only). Creates EXAMPLE stores, two look-only demo logins, and generated
 * camera counts + register sales that keep filling in up to the current time, so a shared demo link
 * always looks live. Everything is named "EXAMPLE" and the portal shows a demo banner on every page.
 *
 * The simulation is deterministic per store and day, so restarts continue the same day seamlessly
 * and never insert a round twice. Never enable this against a database with real stores.
 */
import { DEFAULT_HOURS } from '@foxtail/shared';
import { isDemoMode } from '../config.js';
import { q, tx } from '../db/pool.js';
import { tempPassword } from '../lib/ids.js';
import { hashPassword } from './users.js';
import { clearInsightsCache } from './counting/insights.js';
import { startOfLocalDay, addLocalDays, zonedToUtc, tzParts } from './counting/time.js';

const TZ = 'America/Chicago';
const DAYS_BACK = 15;
const INTERVAL_S = 30;

export const DEMO_LOGINS = {
  corporate: { id: 'us_demo_corporate', email: 'corporate@demo.foxtail', name: 'Demo – Corporate', role: 'corporate_viewer' as const, franchiseeId: null as string | null },
  owner: { id: 'us_demo_owner', email: 'owner@demo.foxtail', name: 'Demo – Franchise owner', role: 'franchise_owner' as const, franchiseeId: 'fr_demo_magnolia' },
};

export function isDemoUser(userId: string): boolean {
  return userId === DEMO_LOGINS.corporate.id || userId === DEMO_LOGINS.owner.id;
}

const FRANCHISEES = [
  { id: 'fr_demo_magnolia', name: 'EXAMPLE – Magnolia Coffee Group' },
  { id: 'fr_demo_delta', name: 'EXAMPLE – Delta Bean Partners' },
];

interface DemoStore { id: string; name: string; number: string; city: string; franchiseeId: string | null; traffic: number; staff: 'short' | 'ok' | 'good'; pos: boolean; counting: boolean }
const STORES: DemoStore[] = [
  { id: 'st_demo_fondren', name: 'EXAMPLE – Jackson Fondren', number: 'EX1', city: 'Jackson', franchiseeId: 'fr_demo_magnolia', traffic: 1.3, staff: 'short', pos: true, counting: true },
  { id: 'st_demo_ridgeland', name: 'EXAMPLE – Ridgeland', number: 'EX2', city: 'Ridgeland', franchiseeId: 'fr_demo_magnolia', traffic: 1.0, staff: 'good', pos: true, counting: true },
  { id: 'st_demo_hattiesburg', name: 'EXAMPLE – Hattiesburg', number: 'EX3', city: 'Hattiesburg', franchiseeId: 'fr_demo_delta', traffic: 0.8, staff: 'good', pos: true, counting: true },
  { id: 'st_demo_oxford', name: 'EXAMPLE – Oxford Square', number: 'EX4', city: 'Oxford', franchiseeId: null, traffic: 1.1, staff: 'ok', pos: false, counting: true },
  { id: 'st_demo_starkville', name: 'EXAMPLE – Starkville (counting not set up yet)', number: 'EX5', city: 'Starkville', franchiseeId: 'fr_demo_delta', traffic: 0, staff: 'ok', pos: false, counting: false },
];

const ZONES = [
  { key: 'entry', type: 'ENTRY', label: 'Entrance', audience: 'customer', at: [0, 0], capacity: null, min: null, max: null },
  { key: 'line', type: 'QUEUE', label: 'Register line', audience: 'customer', at: [0.3, 0], capacity: null, min: null, max: null },
  { key: 'order', type: 'REGISTER', label: 'Ordering spot', audience: 'customer', at: [0.6, 0], capacity: null, min: null, max: null },
  { key: 'counter', type: 'REGISTER', label: 'Behind the counter', audience: 'staff', at: [0.6, 0.5], capacity: null, min: 2, max: 3 },
  { key: 'pickup', type: 'PICKUP', label: 'Pickup', audience: 'customer', at: [0.3, 0.5], capacity: null, min: null, max: null },
  { key: 'seating', type: 'INDOOR_SEATING', label: 'Seating', audience: 'customer', at: [0, 0.5], capacity: 24, min: null, max: null },
] as const;
const zoneId = (storeId: string, key: string) => `zn_${storeId.slice(3)}_${key}`;

/** Create the demo franchisees, stores, areas and logins if they are missing. */
async function ensureStructure(): Promise<void> {
  await tx(async c => {
    for (const f of FRANCHISEES) await c.query('INSERT INTO franchisees (id, name) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [f.id, f.name]);
    for (const s of STORES) {
      await c.query(
        `INSERT INTO stores (id, store_number, name, city, state, timezone, opening_hours, franchisee_id) VALUES ($1,$2,$3,$4,'MS',$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.number, s.name, s.city, TZ, JSON.stringify(DEFAULT_HOURS), s.franchiseeId]);
      if (!s.counting) continue;
      await c.query(`INSERT INTO recorders (store_id, vendor, connection) VALUES ($1,'uniview','edge') ON CONFLICT (store_id) DO NOTHING`, [s.id]);
      const cam = `cam_${s.id.slice(3)}`;
      await c.query(`INSERT INTO cameras (id, store_id, name, channel) VALUES ($1,$2,'Front counter',2) ON CONFLICT (id) DO NOTHING`, [cam, s.id]);
      for (const [i, z] of ZONES.entries()) {
        const poly = [[z.at[0], z.at[1]], [z.at[0] + 0.2, z.at[1]], [z.at[0] + 0.2, z.at[1] + 0.2], [z.at[0], z.at[1] + 0.2]];
        await c.query(
          `INSERT INTO zones (id, store_id, zone_type, label, audience, camera_id, polygon, capacity, staff_target_min, staff_target_max, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (id) DO NOTHING`,
          [zoneId(s.id, z.key), s.id, z.type, z.label, z.audience, cam, JSON.stringify(poly), z.capacity, z.min, z.max, i]);
      }
      await c.query(`INSERT INTO counting_profiles (store_id, sampling_enabled, sample_interval_seconds) VALUES ($1, TRUE, $2) ON CONFLICT (store_id) DO NOTHING`, [s.id, INTERVAL_S]);
    }
    for (const l of Object.values(DEMO_LOGINS)) {
      // Demo logins have an unusable random password: the only way in is the demo button.
      await c.query(
        `INSERT INTO users (id, email, name, role, franchisee_id, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,$6,FALSE) ON CONFLICT (id) DO NOTHING`,
        [l.id, l.email, l.name, l.role, l.franchiseeId, await hashPassword(tempPassword() + tempPassword())]);
    }
  });
}

/** Small deterministic random generator (same store + day = same day every time). */
function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let x = (h >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}

interface Round { at: Date; counts: Record<string, Array<[number, number]>>; staff: number }

/** One simulated opening day (6 AM – 8 PM) for a store. */
function simulateDay(s: DemoStore, dayStart: Date): { rounds: Round[]; tx: Map<number, number> } {
  const p = tzParts(new Date(dayStart.getTime() + 12 * 3600_000), TZ);
  const key = `${p.year}-${p.month}-${p.day}`;
  const rand = seeded(`${s.id}|${key}`);
  const weekend = p.dow === 0 || p.dow === 6;
  const open = zonedToUtc(p.year, p.month, p.day, 6, 0, TZ).getTime();
  const people: Array<{ k: number; sit: boolean }> = [];
  const rounds: Round[] = [];
  const txByHour = new Map<number, number>();
  for (let i = 0; i < 14 * (3600 / INTERVAL_S); i++) {
    const t = open + i * INTERVAL_S * 1000;
    const hour = 6 + Math.floor(i / (3600 / INTERVAL_S));
    const morning = hour >= 7 && hour < 9, lunch = hour >= 12 && hour < 13;
    const base = weekend ? (hour >= 8 && hour < 11 ? 0.32 : 0.12) : morning ? 0.42 : lunch ? 0.28 : 0.1;
    if (rand() < base * s.traffic * (0.9 + rand() * 0.2)) {
      people.push({ k: 0, sit: rand() < 0.3 });
      const hourStart = zonedToUtc(p.year, p.month, p.day, hour, 0, TZ).getTime();
      if (rand() < 0.54) txByHour.set(hourStart, (txByHour.get(hourStart) || 0) + 1);
    }
    const short = s.staff === 'short' && morning && !weekend;
    const lineLen = (morning ? (short ? 11 : 6) : 4) + Math.floor(rand() * 3);
    const counts: Record<string, Array<[number, number]>> = { entry: [], line: [], order: [], pickup: [], seating: [] };
    for (let j = people.length - 1; j >= 0; j--) {
      const person = people[j];
      person.k++;
      const zone = person.k === 1 ? 'entry' : person.k <= lineLen ? 'line' : person.k <= lineLen + 2 ? 'order' : person.k <= lineLen + 6 ? 'pickup' : person.sit && person.k < lineLen + 50 ? 'seating' : null;
      if (!zone) { people.splice(j, 1); continue; }
      const z = ZONES.find(x => x.key === zone)!;
      counts[zone].push([Math.round((z.at[0] + 0.02 + rand() * 0.16) * 1000) / 1000, Math.round((z.at[1] + 0.05 + rand() * 0.1) * 1000) / 1000]);
    }
    const staff = short ? (rand() < 0.6 ? 1 : 2) : s.staff === 'ok' && lunch ? 1 : 2 + (rand() < 0.2 ? 1 : 0);
    rounds.push({ at: new Date(t), counts, staff });
  }
  return { rounds, tx: txByHour };
}

/** Add generated rounds (and register sales for finished hours) for every demo store up to `now`. */
export async function fillDemoData(now = new Date()): Promise<number> {
  let added = 0;
  for (const s of STORES.filter(x => x.counting)) {
    const r = await q('SELECT MAX(round_at) AS last FROM samples WHERE store_id = $1', [s.id]);
    const last = r.rows[0]?.last ? new Date(r.rows[0].last as string) : null;
    const windowStart = startOfLocalDay(new Date(now.getTime() - DAYS_BACK * 86400_000), TZ);
    const from = startOfLocalDay(new Date(Math.max(last?.getTime() ?? 0, windowStart.getTime())), TZ);
    const cam = `cam_${s.id.slice(3)}`;
    const posHave = s.pos
      ? new Set((await q('SELECT hour_at FROM pos_hourly WHERE store_id = $1 AND hour_at >= $2', [s.id, windowStart])).rows.map(x => new Date(x.hour_at as string).getTime()))
      : new Set<number>();
    for (let day = windowStart; day <= now; day = addLocalDays(day, 1, TZ)) {
      const sim = simulateDay(s, day);
      if (s.pos) {
        // Register sales arrive for an hour once it is over (like a POS export would).
        const rand = seeded(`${s.id}|pos|${day.toISOString()}`);
        for (const [hourStart, n] of sim.tx) {
          const sales = Math.round(n * (6.4 + rand() * 1.4) * 100) / 100;
          if (hourStart + 3600_000 > now.getTime() || posHave.has(hourStart)) continue;
          await q(`INSERT INTO pos_hourly (store_id, hour_at, sales, transactions, source) VALUES ($1,$2,$3,$4,'example') ON CONFLICT (store_id, hour_at) DO NOTHING`, [s.id, new Date(hourStart), sales, n]);
        }
      }
      if (day < from) continue;
      const rows: unknown[][] = [];
      for (const round of sim.rounds) {
        if (round.at > now || (last && round.at <= last)) continue;
        for (const [k, pts] of Object.entries(round.counts)) rows.push([s.id, round.at, zoneId(s.id, k), cam, pts.length, JSON.stringify(pts)]);
        rows.push([s.id, round.at, zoneId(s.id, 'counter'), cam, round.staff, JSON.stringify(Array.from({ length: round.staff }, (_, i) => [0.65 + i * 0.05, 0.6]))]);
      }
      for (let i = 0; i < rows.length; i += 1200) {
        const ch = rows.slice(i, i + 1200);
        await q(`INSERT INTO samples (store_id, round_at, zone_id, camera_id, person_count, points) VALUES ${ch.map((_, k) => `($${k * 6 + 1},$${k * 6 + 2},$${k * 6 + 3},$${k * 6 + 4},$${k * 6 + 5},$${k * 6 + 6})`).join(',')}`, ch.flat());
      }
      added += rows.length;
    }
    if (added) clearInsightsCache(s.id);
  }
  return added;
}

let timer: ReturnType<typeof setInterval> | null = null;

export async function startDemo(): Promise<void> {
  if (!isDemoMode()) return;
  await ensureStructure();
  const n = await fillDemoData();
  console.log(`[demo] demo mode is ON: example stores ready (${n} new example samples)`);
  timer = setInterval(() => { fillDemoData().catch(err => console.error('[demo] fill failed', err)); }, 60_000);
}

export function stopDemo(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export { ensureStructure as ensureDemoStructure };
