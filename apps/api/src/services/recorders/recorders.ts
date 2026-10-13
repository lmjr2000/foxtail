/**
 * A store's recorder (NVR) and its cameras. The recorder password is sealed (secret-box) and never
 * leaves the server; the API only ever reports whether one is set.
 */
import { randomBytes } from 'node:crypto';
import type { RecorderConnection, RecorderVendor, StreamProfile } from '@foxtail/shared';
import { q } from '../../db/pool.js';
import { newId } from '../../lib/ids.js';
import { openSecret, sealSecret, sha256 } from '../secret-box.js';

export interface Recorder {
  storeId: string;
  vendor: RecorderVendor;
  connection: RecorderConnection;
  host: string | null;
  rtspPort: number | null;
  username: string | null;
  hasPassword: boolean;
  pathTemplate: string | null;
  streamProfile: StreamProfile;
  edgeTokenSet: boolean;
  edgeLastSeenAt: string | null;
  edgeVersion: string | null;
  lastTestAt: string | null;
  lastTestOk: boolean | null;
  lastTestError: string | null;
}

export interface Camera { id: string; storeId: string; name: string; channel: number; enabled: boolean }

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);

function rowToRecorder(r: Row): Recorder {
  return {
    storeId: String(r.store_id), vendor: r.vendor as RecorderVendor, connection: r.connection as RecorderConnection,
    host: (r.host as string) ?? null, rtspPort: r.rtsp_port === null ? null : Number(r.rtsp_port), username: (r.username as string) ?? null,
    hasPassword: !!r.password_sealed, pathTemplate: (r.path_template as string) ?? null, streamProfile: r.stream_profile === 'main' ? 'main' : 'sub',
    edgeTokenSet: !!r.edge_token_hash, edgeLastSeenAt: iso(r.edge_last_seen_at), edgeVersion: (r.edge_version as string) ?? null,
    lastTestAt: iso(r.last_test_at), lastTestOk: r.last_test_ok === null || r.last_test_ok === undefined ? null : r.last_test_ok === true, lastTestError: (r.last_test_error as string) ?? null,
  };
}

export async function getRecorder(storeId: string): Promise<Recorder | null> {
  const r = await q('SELECT * FROM recorders WHERE store_id = $1', [storeId]);
  return r.rows[0] ? rowToRecorder(r.rows[0]) : null;
}

/** Server-only: the recorder with its password opened, for building RTSP URLs. */
export async function getRecorderCredentials(storeId: string): Promise<(Recorder & { password: string | null }) | null> {
  const r = await q('SELECT * FROM recorders WHERE store_id = $1', [storeId]);
  if (!r.rows[0]) return null;
  return { ...rowToRecorder(r.rows[0]), password: openSecret(r.rows[0].password_sealed as string | null) };
}

export interface RecorderInput {
  vendor: RecorderVendor; connection: RecorderConnection; host: string | null; rtspPort: number | null; username: string | null;
  /** undefined = keep the stored password; '' = clear it. */
  password?: string; pathTemplate: string | null; streamProfile: StreamProfile;
}

export async function saveRecorder(storeId: string, input: RecorderInput): Promise<Recorder> {
  const sealed = input.password === undefined ? undefined : input.password === '' ? null : sealSecret(input.password);
  const r = await q(
    `INSERT INTO recorders (store_id, vendor, connection, host, rtsp_port, username, password_sealed, path_template, stream_profile, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (store_id) DO UPDATE SET vendor=EXCLUDED.vendor, connection=EXCLUDED.connection, host=EXCLUDED.host, rtsp_port=EXCLUDED.rtsp_port,
       username=EXCLUDED.username, password_sealed=${sealed === undefined ? 'recorders.password_sealed' : 'EXCLUDED.password_sealed'},
       path_template=EXCLUDED.path_template, stream_profile=EXCLUDED.stream_profile, updated_at=NOW()
     RETURNING *`,
    [storeId, input.vendor, input.connection, input.host, input.rtspPort, input.username, sealed ?? null, input.pathTemplate, input.streamProfile],
  );
  return rowToRecorder(r.rows[0]);
}

export async function recordTest(storeId: string, ok: boolean, error: string | null): Promise<void> {
  await q('UPDATE recorders SET last_test_at = NOW(), last_test_ok = $2, last_test_error = $3 WHERE store_id = $1', [storeId, ok, error]);
}

/** New edge token for the store (returned once; only its hash is stored). Replaces any previous token. */
export async function rotateEdgeToken(storeId: string): Promise<string> {
  const token = `fxe_${randomBytes(24).toString('base64url')}`;
  const r = await q('UPDATE recorders SET edge_token_hash = $2, updated_at = NOW() WHERE store_id = $1', [storeId, sha256(token)]);
  if (!r.rowCount) throw Object.assign(new Error('Save the recorder first'), { status: 400 });
  return token;
}

/** The store an edge token belongs to (null when unknown or the store is archived). */
export async function storeIdForEdgeToken(token: string): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const r = await q(
    `SELECT r.store_id FROM recorders r JOIN stores s ON s.id = r.store_id
      WHERE r.edge_token_hash = $1 AND r.connection = 'edge' AND s.archived_at IS NULL`, [sha256(token)]);
  return r.rows[0] ? String(r.rows[0].store_id) : null;
}

export async function touchEdge(storeId: string, version: string | null): Promise<void> {
  await q('UPDATE recorders SET edge_last_seen_at = NOW(), edge_version = COALESCE($2, edge_version) WHERE store_id = $1', [storeId, version]);
}

// ------------------------------------------------------------------------------------------- cameras

function rowToCamera(r: Row): Camera {
  return { id: String(r.id), storeId: String(r.store_id), name: String(r.name), channel: Number(r.channel), enabled: r.enabled !== false };
}

export async function listCameras(storeId: string): Promise<Camera[]> {
  const r = await q('SELECT * FROM cameras WHERE store_id = $1 ORDER BY channel', [storeId]);
  return r.rows.map(rowToCamera);
}

/** The camera, only when it belongs to this store. */
export async function getCamera(storeId: string, cameraId: string): Promise<Camera | null> {
  const r = await q('SELECT * FROM cameras WHERE id = $1 AND store_id = $2', [cameraId, storeId]);
  return r.rows[0] ? rowToCamera(r.rows[0]) : null;
}

export async function addCamera(storeId: string, name: string, channel: number): Promise<Camera> {
  const r = await q('INSERT INTO cameras (id, store_id, name, channel) VALUES ($1,$2,$3,$4) RETURNING *', [newId('cam'), storeId, name, channel]);
  return rowToCamera(r.rows[0]);
}

export async function updateCamera(storeId: string, cameraId: string, patch: { name?: string; channel?: number; enabled?: boolean }): Promise<Camera | null> {
  const r = await q(
    `UPDATE cameras SET name = COALESCE($3, name), channel = COALESCE($4, channel), enabled = COALESCE($5, enabled)
      WHERE id = $1 AND store_id = $2 RETURNING *`,
    [cameraId, storeId, patch.name ?? null, patch.channel ?? null, patch.enabled ?? null],
  );
  return r.rows[0] ? rowToCamera(r.rows[0]) : null;
}

export async function deleteCamera(storeId: string, cameraId: string): Promise<boolean> {
  const r = await q('DELETE FROM cameras WHERE id = $1 AND store_id = $2', [cameraId, storeId]);
  return (r.rowCount ?? 0) > 0;
}
