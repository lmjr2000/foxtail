/**
 * Presence tracking from periodic people samples.
 *
 * The sampler stores, per zone per round, the foot points of every person the detector saw inside
 * the zone. Linking points between consecutive rounds (greedy nearest neighbour within a distance)
 * gives "tracks": one person's continuous presence in one zone. Track length is how long they stayed
 * (wait in a line, dwell at pickup, time seated). No identity is involved — a track never leaves its
 * zone, and nothing about who the person is gets stored.
 *
 * Precision: with sampling every S seconds, a presence is known to about ±S. The expected true
 * duration of a track seen from first..last is (last - first) + S, which is what presenceSeconds uses.
 */

export interface SamplePoint { x: number; y: number }

export interface TrackSample {
  roundAt: Date;
  targetId: string;
  points: Array<[number, number]>;
  count: number;
}

export interface Track {
  targetId: string;
  start: Date;
  end: Date;
  samples: number;
  /** Still present in the final round of the input (has not "left" yet). */
  open: boolean;
  lastPoint: [number, number];
}

export interface TrackOptions {
  /** Max normalized distance (0..1 of frame) a person can move between rounds and stay the same track. */
  maxDistance: number;
  /** Rounds further apart than this (ms) break a track. */
  maxGapMs: number;
}

function dist(a: [number, number], b: [number, number]): number {
  const dx = a[0] - b[0], dy = a[1] - b[1];
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build tracks for ONE target (zone or table) from its samples (any order). When a sample has a count
 * but fewer points (older rows, detector without boxes), the missing people get placeholder points at
 * the zone centre so counts still produce presences.
 */
export function buildTracks(samples: TrackSample[], opts: TrackOptions): Track[] {
  const sorted = [...samples].sort((a, b) => a.roundAt.getTime() - b.roundAt.getTime());
  const done: Track[] = [];
  let active: Track[] = [];
  let lastRound: number | null = null;
  for (const s of sorted) {
    const t = s.roundAt.getTime();
    // Close tracks that have not been seen for too long.
    if (lastRound !== null) {
      const still: Track[] = [];
      for (const tr of active) {
        if (t - tr.end.getTime() > opts.maxGapMs) { tr.open = false; done.push(tr); } else still.push(tr);
      }
      active = still;
    }
    const pts: Array<[number, number]> = [...(s.points || [])];
    while (pts.length < s.count) pts.push([0.5, 0.5 + pts.length * 0.0001]);
    // Greedy assignment: closest pairs first.
    const pairs: Array<{ ti: number; pi: number; d: number }> = [];
    active.forEach((tr, ti) => pts.forEach((p, pi) => {
      const d = dist(tr.lastPoint, p);
      if (d <= opts.maxDistance) pairs.push({ ti, pi, d });
    }));
    pairs.sort((a, b) => a.d - b.d);
    const usedT = new Set<number>(), usedP = new Set<number>();
    for (const pr of pairs) {
      if (usedT.has(pr.ti) || usedP.has(pr.pi)) continue;
      usedT.add(pr.ti); usedP.add(pr.pi);
      const tr = active[pr.ti];
      tr.end = s.roundAt; tr.samples += 1; tr.lastPoint = pts[pr.pi];
    }
    // Tracks present in the previous round but not matched now have left (this round saw the zone).
    const next: Track[] = [];
    active.forEach((tr, ti) => {
      if (usedT.has(ti)) next.push(tr);
      else if (t - tr.end.getTime() > opts.maxGapMs) { tr.open = false; done.push(tr); }
      else next.push(tr); // allow one missed detection within the gap
    });
    active = next;
    pts.forEach((p, pi) => {
      if (!usedP.has(pi)) active.push({ targetId: s.targetId, start: s.roundAt, end: s.roundAt, samples: 1, open: true, lastPoint: p });
    });
    lastRound = t;
  }
  // Anything still active: open only if it was seen in the very last round.
  for (const tr of active) {
    tr.open = lastRound !== null && tr.end.getTime() === lastRound;
    done.push(tr);
  }
  return done.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function presenceSeconds(tr: Track, intervalSeconds: number): number {
  return (tr.end.getTime() - tr.start.getTime()) / 1000 + intervalSeconds;
}

/** Point-in-polygon (ray casting). Polygon and point are normalized 0..1. */
export function pointInPolygon(pt: [number, number], poly: Array<[number, number]>): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const hit = (yi > pt[1]) !== (yj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi || 1e-12) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

export function polygonArea(poly: Array<[number, number]>): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

export interface PersonBox { x: number; y: number; width: number; height: number; confidence: number }

/**
 * Assign detected people to zones on ONE camera. Each person is placed by their foot point (bottom
 * centre of the box) into the smallest zone polygon that contains it, so overlapping zones never
 * count a person twice.
 */
export function assignPeopleToZones(
  boxes: PersonBox[],
  imageWidth: number,
  imageHeight: number,
  zones: Array<{ id: string; polygon: Array<[number, number]> }>,
): Map<string, Array<[number, number]>> {
  const out = new Map<string, Array<[number, number]>>();
  for (const z of zones) out.set(z.id, []);
  if (!imageWidth || !imageHeight) return out;
  const ordered = [...zones].sort((a, b) => polygonArea(a.polygon) - polygonArea(b.polygon));
  for (const b of boxes) {
    const foot: [number, number] = [
      Math.min(1, Math.max(0, b.x / imageWidth)),
      Math.min(1, Math.max(0, (b.y + b.height / 2) / imageHeight)),
    ];
    const z = ordered.find(zz => pointInPolygon(foot, zz.polygon));
    if (z) out.get(z.id)!.push([Math.round(foot[0] * 1000) / 1000, Math.round(foot[1] * 1000) / 1000]);
  }
  return out;
}
