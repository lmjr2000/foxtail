/**
 * Real inventory from the EZCloud Channel Management export, and who can see/watch cameras.
 * The CSV below only exercises the parser (format copied from Eye of Omni's import test).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { api, makeUser, resetDb } from './helpers.js';
import { q } from '../src/db/pool.js';
import { externalIdFor, parseChannelExport, storeNameFromDevice } from '../src/services/inventory/ezcloud-import.js';

const T = '\t';
const EXPORT = [
  ['', 'Channel Name', 'Channel Version', 'Channel Serial No.', 'Channel No.', 'Device', 'Device Model', 'Device Type', 'Device Owner', 'Organization', 'Status'],
  ['', 'WEST LOBBY', '1.0', 'SN-A1', '1', 'Foxtail / Store One, FL', 'NVR504-16B-P16-IQ', 'IPC', 'Owner A', 'Org', 'Online'],
  ['', 'REGISTER', '1.0', 'SN-A2', '2', 'Foxtail / Store One, FL', 'NVR504-16B-P16-IQ', 'IPC', 'Owner A', 'Org', 'Offline'],
  ['', 'DRIVE THRU', '1.0', 'SN-B1', '1', 'Store Two, MS', 'NVR301-08S3', 'IPC', 'Owner B', 'Org', 'Online'],
].map(r => r.join(T)).join('\r\n');

let admin: Awaited<ReturnType<typeof makeUser>>;

beforeAll(async () => {
  await resetDb();
  admin = await makeUser('corporate_admin');
});

describe('EZCloud Channel Management parser', () => {
  it('reads tab-separated exports with leading tabs', () => {
    const p = parseChannelExport(EXPORT);
    expect(p.channels).toHaveLength(3);
    expect([...p.devices.keys()]).toEqual(['Foxtail / Store One, FL', 'Store Two, MS']);
    expect(p.channels[1]).toMatchObject({ channelName: 'REGISTER', channelNo: '2', status: 'offline', channelSerialNo: 'SN-A2' });
  });

  it('reads the comma-separated export whose quoted headers start with a tab', () => {
    const csv = '﻿"\tChannel Name","\tChannel Serial No.","\tChannel No.","\tDevice","\tDevice Model","\tStatus"\r\n"\tFRONT","\tSN-9","\t3","\tStore Three, TX","\tNVR301","\tOnline"';
    const p = parseChannelExport(csv);
    expect(p.errors).toEqual([]);
    expect(p.channels[0]).toMatchObject({ channelName: 'FRONT', channelNo: '3', device: 'Store Three, TX', status: 'online' });
  });

  it('turns "Foxtail / Name, ST" into a store name and state', () => {
    expect(storeNameFromDevice('Foxtail / Hamlin-Porter Rd, FL')).toEqual({ name: 'Hamlin-Porter Rd, FL', state: 'FL' });
  });

  it('cameras with the same "serial no." are still separate cameras (it is a model code, not unique)', () => {
    const csv = ['Channel Name,Channel Serial No.,Channel No.,Device,Status', 'Lobby,SAME-CODE,1,Store X, FL,Online', 'Patio,SAME-CODE,2,Store X, FL,Online']
      .map(l => l.replace('Store X, FL', '"Store X, FL"')).join('\n');
    const p = parseChannelExport(csv);
    expect(new Set(p.channels.map(externalIdFor)).size).toBe(2);
  });

  it('rejects files that are not the channel export', () => {
    expect(parseChannelExport('a,b\n1,2').errors[0]).toMatch(/Device/);
  });
});

describe('import', () => {
  it('previews without writing anything', async () => {
    const r = await api().post('/api/imports/ezcloud-channels').set(admin.auth).send({ csv: EXPORT, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dryRun: true, storesCreated: 2, camerasCreated: 3, online: 2, offline: 1 });
    expect((await q('SELECT COUNT(*)::int AS n FROM stores')).rows[0].n).toBe(0);
  });

  it('creates every store and camera with its status, timezone from the state', async () => {
    const r = await api().post('/api/imports/ezcloud-channels').set(admin.auth).send({ csv: EXPORT });
    expect(r.body).toMatchObject({ storesCreated: 2, camerasCreated: 3 });
    const stores = await api().get('/api/stores').set(admin.auth);
    const one = stores.body.stores.find((s: { name: string }) => s.name === 'Store One, FL');
    expect(one).toMatchObject({ state: 'FL', timezone: 'America/New_York', recorderModel: 'NVR504-16B-P16-IQ', cameras: { total: 2, online: 1, offline: 1, video: 'none' } });
    const two = stores.body.stores.find((s: { name: string }) => s.name === 'Store Two, MS');
    expect(two.timezone).toBe('America/Chicago');
    const cams = await api().get(`/api/stores/${one.id}/cameras`).set(admin.auth);
    expect(cams.body.cameras.map((c: { name: string; channel: number; status: string }) => [c.name, c.channel, c.status])).toEqual([['WEST LOBBY', 1, 'online'], ['REGISTER', 2, 'offline']]);
    expect(cams.body.video.mode).toBe('none');
  });

  it('a newer export updates status in place and never duplicates', async () => {
    const newer = EXPORT.replace('Offline', 'Online');
    const r = await api().post('/api/imports/ezcloud-channels').set(admin.auth).send({ csv: newer });
    expect(r.body).toMatchObject({ storesCreated: 0, storesUpdated: 2, camerasCreated: 0, camerasUpdated: 3 });
    expect((await q('SELECT COUNT(*)::int AS n FROM cameras')).rows[0].n).toBe(3);
    expect((await q(`SELECT COUNT(*)::int AS n FROM cameras WHERE status = 'online'`)).rows[0].n).toBe(3);
  });

  it('only corporate admins can import', async () => {
    const viewer = await makeUser('corporate_viewer');
    expect((await api().post('/api/imports/ezcloud-channels').set(viewer.auth).send({ csv: EXPORT })).status).toBe(403);
  });
});

describe('watching cameras', () => {
  it('a franchise owner sees the cameras of their own store; video waits for the recorder login', async () => {
    const st = (await q(`SELECT id FROM stores WHERE name = 'Store One, FL'`)).rows[0].id as string;
    const fr = (await api().post('/api/franchisees').set(admin.auth).send({ name: 'Owner A LLC' })).body.franchisee.id;
    await api().patch(`/api/stores/${st}`).set(admin.auth).send({ franchiseeId: fr });
    const owner = await makeUser('franchise_owner', fr);
    const cams = await api().get(`/api/stores/${st}/cameras`).set(owner.auth);
    expect(cams.status).toBe(200);
    expect(cams.body.cameras).toHaveLength(2);
    const live = await api().get(`/api/stores/${st}/cameras/${cams.body.cameras[0].id}/live/index.m3u8`).set(owner.auth);
    expect(live.status).toBe(409);
    expect(live.body.message).toMatch(/recorder/);
    // The other store is invisible to this owner.
    const other = (await q(`SELECT id FROM stores WHERE name = 'Store Two, MS'`)).rows[0].id as string;
    expect((await api().get(`/api/stores/${other}/cameras`).set(owner.auth)).status).toBe(404);
  });

  it('a live segment that is not being streamed is just "not found"', async () => {
    const st = (await q(`SELECT id FROM stores WHERE name = 'Store One, FL'`)).rows[0].id as string;
    const cam = (await q('SELECT id FROM cameras WHERE store_id = $1 LIMIT 1', [st])).rows[0].id as string;
    expect((await api().get(`/api/stores/${st}/cameras/${cam}/live/seg000001.ts`).set(admin.auth)).status).toBe(404);
    expect((await api().get(`/api/stores/${st}/cameras/${cam}/live/..%2F..%2Fpasswd`).set(admin.auth)).status).toBe(404);
  });
});
