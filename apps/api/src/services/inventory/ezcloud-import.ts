/**
 * Real store + camera inventory from the EZCloud "Channel Management" CSV export (parser carried over
 * from Eye of Omni's EZCloud/Foxtail status import, which is how the "Foxtail / <store>" locations
 * got into Eye of Omni).
 *
 * One store per EZCloud "Device" (the store's recorder), one camera per channel, with the
 * online/offline status from the export. Re-importing a newer export updates names, models and
 * status in place (stores matched by device name, cameras by serial number) and never duplicates.
 * Adding the recorder's address and login to a store later turns on live video and counting for the
 * same cameras (channel numbers line up with the recorder).
 *
 * CSV columns (may have leading tabs): Channel Name, Channel Version, Channel Serial No., Channel No.,
 * Device, Device Model, Device Type, Device Owner, Organization, Status (Online|Offline).
 */
import { DEFAULT_HOURS, DEFAULT_TIMEZONE } from '@foxtail/shared';
import { tx } from '../../db/pool.js';
import { newId } from '../../lib/ids.js';

export interface EzChannel {
  channelName: string; channelSerialNo: string; channelNo: string; device: string; deviceModel: string;
  deviceType: string; deviceOwner: string; organization: string; status: 'online' | 'offline';
}

export interface ParsedExport { channels: EzChannel[]; devices: Map<string, EzChannel[]>; errors: string[]; rowsSkipped: number }

const HEADER_ALIASES: Record<string, string> = {
  'channel name': 'channelname', 'channel version': 'channelversion', 'channel serial no.': 'channelserialno', 'channel serial no': 'channelserialno',
  'channel no.': 'channelno', 'channel no': 'channelno', device: 'device', 'device model': 'devicemodel', 'device type': 'devicetype',
  'device owner': 'deviceowner', organization: 'organization', status: 'status',
};

function normalizeHeader(h: string): string {
  const cleaned = h.toLowerCase().trim().replace(/[\t\r\n]+/g, ' ').replace(/\s+/g, ' ');
  return HEADER_ALIASES[cleaned] || cleaned.replace(/[^a-z]/g, '');
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted; }
    else if (ch === delimiter && !quoted) { out.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseChannelExport(csv: string): ParsedExport {
  const channels: EzChannel[] = [];
  const devices = new Map<string, EzChannel[]>();
  const errors: string[] = [];
  let rowsSkipped = 0;
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { channels, devices, errors: ['The file is empty.'], rowsSkipped };
  // Count separators outside quotes: real exports quote every header with a leading tab ("\tDevice").
  const bare = lines[0].replace(/"[^"]*"/g, '');
  const delimiter = (bare.match(/\t/g) || []).length > (bare.match(/,/g) || []).length ? '\t' : ',';
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const col = (name: string) => headers.indexOf(name);
  const iDevice = col('device'), iStatus = col('status');
  if (iDevice < 0 || iStatus < 0) {
    return { channels, devices, errors: ['This does not look like an EZCloud Channel Management export: it needs "Device" and "Status" columns.'], rowsSkipped };
  }
  const get = (vals: string[], name: string) => { const i = col(name); return i >= 0 ? (vals[i] || '').trim() : ''; };
  for (let i = 1; i < lines.length; i++) {
    const vals = parseCsvLine(lines[i], delimiter);
    const device = get(vals, 'device');
    if (!device) { rowsSkipped++; errors.push(`Row ${i + 1}: no Device name`); continue; }
    const st = get(vals, 'status').toLowerCase();
    const ch: EzChannel = {
      channelName: get(vals, 'channelname'), channelSerialNo: get(vals, 'channelserialno'), channelNo: get(vals, 'channelno'),
      device, deviceModel: get(vals, 'devicemodel'), deviceType: get(vals, 'devicetype'), deviceOwner: get(vals, 'deviceowner'),
      organization: get(vals, 'organization'), status: st === 'online' || st === '1' || st === 'true' ? 'online' : 'offline',
    };
    channels.push(ch);
    if (!devices.has(device)) devices.set(device, []);
    devices.get(device)!.push(ch);
  }
  return { channels, devices, errors, rowsSkipped };
}

/**
 * Stable id for a camera across exports: recorder + channel number (unique on a recorder). The export's
 * "Channel Serial No." is a model/batch code shared by many cameras, so it is kept only as information.
 */
export function externalIdFor(ch: EzChannel): string {
  const slug = (s: string, n: number) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n);
  const no = Number.parseInt(ch.channelNo, 10);
  return `ezcloud:${slug(ch.device, 60)}:${Number.isInteger(no) ? `ch${no}` : slug(ch.channelName, 40) || '0'}`;
}

/** "Foxtail / Hamlin-Porter Rd, FL" or "Hamlin-Porter Rd, FL" -> store name and state. */
export function storeNameFromDevice(device: string): { name: string; state: string | null } {
  const name = device.replace(/^\s*foxtail\s*\/\s*/i, '').trim();
  const m = /,\s*([A-Za-z]{2})\s*$/.exec(name);
  return { name, state: m ? m[1].toUpperCase() : null };
}

const STATE_TZ: Record<string, string> = {
  AL: 'America/Chicago', AR: 'America/Chicago', AZ: 'America/Phoenix', CA: 'America/Los_Angeles', CO: 'America/Denver', CT: 'America/New_York',
  DC: 'America/New_York', DE: 'America/New_York', FL: 'America/New_York', GA: 'America/New_York', IA: 'America/Chicago', ID: 'America/Boise',
  IL: 'America/Chicago', IN: 'America/Indiana/Indianapolis', KS: 'America/Chicago', KY: 'America/New_York', LA: 'America/Chicago', MA: 'America/New_York',
  MD: 'America/New_York', ME: 'America/New_York', MI: 'America/Detroit', MN: 'America/Chicago', MO: 'America/Chicago', MS: 'America/Chicago',
  MT: 'America/Denver', NC: 'America/New_York', ND: 'America/Chicago', NE: 'America/Chicago', NH: 'America/New_York', NJ: 'America/New_York',
  NM: 'America/Denver', NV: 'America/Los_Angeles', NY: 'America/New_York', OH: 'America/New_York', OK: 'America/Chicago', OR: 'America/Los_Angeles',
  PA: 'America/New_York', RI: 'America/New_York', SC: 'America/New_York', SD: 'America/Chicago', TN: 'America/Chicago', TX: 'America/Chicago',
  UT: 'America/Denver', VA: 'America/New_York', VT: 'America/New_York', WA: 'America/Los_Angeles', WI: 'America/Chicago', WV: 'America/New_York', WY: 'America/Denver',
};

export interface ImportSummary {
  dryRun: boolean;
  stores: Array<{ name: string; device: string; model: string; cameras: number; online: number; offline: number; action: 'create' | 'update' | 'skip-archived'; storeId: string | null; owner: string | null }>;
  storesCreated: number; storesUpdated: number; camerasCreated: number; camerasUpdated: number;
  online: number; offline: number; rowsSkipped: number; errors: string[];
}

export async function importChannelExport(csv: string, opts: { dryRun: boolean }): Promise<ImportSummary | { error: string }> {
  const parsed = parseChannelExport(csv);
  if (!parsed.channels.length) return { error: parsed.errors[0] || 'No camera rows were found in this file.' };
  const summary: ImportSummary = {
    dryRun: opts.dryRun, stores: [], storesCreated: 0, storesUpdated: 0, camerasCreated: 0, camerasUpdated: 0,
    online: parsed.channels.filter(c => c.status === 'online').length, offline: parsed.channels.filter(c => c.status === 'offline').length,
    rowsSkipped: parsed.rowsSkipped, errors: parsed.errors.slice(0, 50),
  };
  await tx(async c => {
    for (const [device, chans] of parsed.devices) {
      const { name, state } = storeNameFromDevice(device);
      const model = chans.find(x => x.deviceModel)?.deviceModel || null;
      const existing = (await c.query('SELECT id, archived_at FROM stores WHERE lower(source_device_name) = lower($1)', [device])).rows[0];
      const row: ImportSummary['stores'][number] = {
        name, device, model: model || '', cameras: chans.length, online: chans.filter(x => x.status === 'online').length, offline: chans.filter(x => x.status === 'offline').length,
        action: existing ? (existing.archived_at ? 'skip-archived' : 'update') : 'create', storeId: existing ? String(existing.id) : null,
        owner: chans.find(x => x.deviceOwner)?.deviceOwner || chans.find(x => x.organization)?.organization || null,
      };
      summary.stores.push(row);
      if (row.action === 'skip-archived') continue;
      if (row.action === 'create') summary.storesCreated++; else summary.storesUpdated++;
      if (opts.dryRun) {
        for (const ch of chans) {
          const known = (await c.query('SELECT 1 FROM cameras WHERE external_id = $1', [externalIdFor(ch)])).rowCount;
          if (known) summary.camerasUpdated++; else summary.camerasCreated++;
        }
        continue;
      }
      let storeId = row.storeId;
      if (!storeId) {
        storeId = newId('st');
        await c.query(
          `INSERT INTO stores (id, name, state, timezone, opening_hours, source_device_name, recorder_model) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [storeId, name, state, (state && STATE_TZ[state]) || DEFAULT_TIMEZONE, JSON.stringify(DEFAULT_HOURS), device, model]);
        row.storeId = storeId;
      } else {
        await c.query('UPDATE stores SET recorder_model = COALESCE($2, recorder_model), updated_at = NOW() WHERE id = $1', [storeId, model]);
      }
      const used = new Set((await c.query('SELECT channel FROM cameras WHERE store_id = $1', [storeId])).rows.map(x => Number(x.channel)));
      for (const ch of chans) {
        const extId = externalIdFor(ch);
        const label = ch.channelName || `Channel ${ch.channelNo || '?'}`;
        const upd = await c.query(
          `UPDATE cameras SET name = $2, model = $3, serial_no = $4, status = $5, status_at = NOW(), status_source = 'ezcloud'
            WHERE external_id = $1 AND store_id = $6`,
          [extId, label, ch.deviceType || null, ch.channelSerialNo || null, ch.status, storeId]);
        if (upd.rowCount) { summary.camerasUpdated++; continue; }
        let channel = Number.parseInt(ch.channelNo, 10);
        if (!Number.isInteger(channel) || channel < 1 || channel > 256 || used.has(channel)) {
          channel = 1;
          while (used.has(channel) && channel < 256) channel++;
        }
        used.add(channel);
        await c.query(
          `INSERT INTO cameras (id, store_id, name, channel, source, external_id, model, serial_no, status, status_at, status_source)
           VALUES ($1,$2,$3,$4,'ezcloud',$5,$6,$7,$8,NOW(),'ezcloud') ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO NOTHING`,
          [newId('cam'), storeId, label, channel, extId, ch.deviceType || null, ch.channelSerialNo || null, ch.status]);
        summary.camerasCreated++;
      }
    }
    if (opts.dryRun) throw Object.assign(new Error('dry run'), { dryRun: true });
  }).catch(err => { if (!(err as { dryRun?: boolean }).dryRun) throw err; });
  summary.stores.sort((a, b) => a.name.localeCompare(b.name));
  return summary;
}
