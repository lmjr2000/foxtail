import { describe, expect, it } from 'vitest';
import { DEFAULT_HOURS, DEFAULT_KPIS, resolveCountingConfig, validateCountingOverrides, validateHours, validateZones } from './counting.js';
import { buildRtspUrl, redactRtsp, rtspPathFor } from './recorders.js';
import { canManage, isCorporate } from './roles.js';

const store = { timezone: 'America/Chicago', openingHours: DEFAULT_HOURS };

describe('resolveCountingConfig', () => {
  it('uses coffee defaults when the store has no profile', () => {
    const c = resolveCountingConfig(null, store);
    expect(c.configured).toBe(false);
    expect(c.kpis.map(k => k.key)).toEqual(DEFAULT_KPIS);
    expect(c.samplingEnabled).toBe(false);
    expect(c.timezone).toBe('America/Chicago');
  });

  it('applies overrides and clamps targets', () => {
    const c = resolveCountingConfig({ kpiMetrics: ['waitTime'], thresholds: { waitTargetSeconds: 99999 }, samplingEnabled: true, sampleIntervalSeconds: 1 }, store);
    expect(c.kpis.map(k => k.key)).toEqual(['waitTime']);
    expect(c.thresholds.waitTargetSeconds).toBe(7200);
    expect(c.sampleIntervalSeconds).toBe(10);
    expect(c.configured).toBe(true);
  });

  it('drops metrics of switched-off sections but always keeps traffic', () => {
    const c = resolveCountingConfig({ enabledModules: ['queue'] }, store);
    const keys = c.metrics.map(m => m.key);
    expect(keys).toContain('customersEntered');
    expect(keys).toContain('waitTime');
    expect(keys).not.toContain('seatingUtilization');
  });
});

describe('validation', () => {
  it('rejects unknown KPIs and out-of-range targets', () => {
    const v = validateCountingOverrides({ kpiMetrics: ['nope'], thresholds: { waitTargetSeconds: 1 } });
    expect(v.ok).toBe(false);
  });

  it('validates areas and polygons', () => {
    expect(validateZones([{ zoneType: 'QUEUE', polygon: [[0, 0], [1, 0], [1, 1]] }]).ok).toBe(true);
    expect(validateZones([{ zoneType: 'TABLE_ZONE' }]).ok).toBe(false);
    expect(validateZones([{ zoneType: 'QUEUE', polygon: [[0, 0], [2, 0], [1, 1]] }]).ok).toBe(false);
    expect(validateZones([{ zoneType: 'REGISTER', staffTargetMin: 3, staffTargetMax: 1 }]).ok).toBe(false);
  });

  it('validates opening hours', () => {
    expect(validateHours(DEFAULT_HOURS).ok).toBe(true);
    expect(validateHours({ ...DEFAULT_HOURS, mon: { open: '25:00', close: '10:00' } }).ok).toBe(false);
  });
});

describe('recorders', () => {
  it('builds vendor stream paths', () => {
    expect(rtspPathFor({ vendor: 'uniview', channel: 3 })).toBe('/unicast/c3/s1/live');
    expect(rtspPathFor({ vendor: 'hikvision', channel: 2, profile: 'main' })).toBe('/Streaming/Channels/201');
    expect(rtspPathFor({ vendor: 'custom', channel: 4, pathTemplate: 'live/{ch0}' })).toBe('/live/3');
  });

  it('encodes and redacts credentials', () => {
    const url = buildRtspUrl({ vendor: 'uniview', host: '10.0.0.5', username: 'admin', password: 'p@ss:word', channel: 1 });
    expect(url).toBe('rtsp://admin:p%40ss%3Aword@10.0.0.5:554/unicast/c1/s1/live');
    expect(redactRtsp(url)).toBe('rtsp://[redacted]@10.0.0.5:554/unicast/c1/s1/live');
  });
});

describe('roles', () => {
  it('only corporate admins manage; corporate roles see everything', () => {
    expect(canManage('corporate_admin')).toBe(true);
    expect(canManage('corporate_viewer')).toBe(false);
    expect(canManage('franchise_owner')).toBe(false);
    expect(isCorporate('corporate_viewer')).toBe(true);
    expect(isCorporate('franchise_owner')).toBe(false);
  });
});
