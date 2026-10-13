/**
 * The on-site edge agent (apps/edge-agent), for recorders the cloud cannot reach. It authenticates with
 * the store's edge token ("X-Edge-Token"), never a user login, and can only ever touch its own store.
 *
 * GET  /api/edge/config                      cameras to capture, interval, whether the store is open now
 * POST /api/edge/frames/:cameraId            body: image/jpeg (one frame; kept in memory for the next count)
 */
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { badRequest, notFound, unauthorized } from '../lib/http.js';
import { putEdgeFrame } from '../services/recorders/capture.js';
import { getCamera, listCameras, storeIdForEdgeToken, touchEdge } from '../services/recorders/recorders.js';
import { storeForSystem } from '../services/stores.js';
import * as countingStore from '../services/counting/store.js';
import { isOpenAt } from '../services/counting/time.js';

declare module 'express-serve-static-core' {
  interface Request { edgeStoreId?: string }
}

const router = Router();

async function edgeAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = String(req.headers['x-edge-token'] || '');
  const storeId = await storeIdForEdgeToken(token);
  if (!storeId) throw unauthorized('Unknown or revoked edge token');
  req.edgeStoreId = storeId;
  await touchEdge(storeId, typeof req.headers['x-edge-version'] === 'string' ? req.headers['x-edge-version'].slice(0, 40) : null);
  next();
}

router.get('/config', edgeAuth, async (req, res) => {
  const store = await storeForSystem(req.edgeStoreId!);
  if (!store) throw notFound();
  const cfg = await countingStore.loadConfig(store);
  const zones = await countingStore.getZones(store.id);
  const used = new Set(zones.filter(z => z.enabled && z.cameraId).map(z => z.cameraId!));
  const cameras = (await listCameras(store.id)).filter(c => c.enabled);
  res.json({
    storeName: store.name,
    timezone: cfg.timezone,
    openNow: isOpenAt(new Date(), cfg.timezone, cfg.operatingHours),
    countingEnabled: cfg.samplingEnabled,
    intervalSeconds: cfg.sampleIntervalSeconds,
    // Counting cameras every interval; the rest only when an admin is drawing areas (requested by the server later).
    cameras: cameras.map(c => ({ id: c.id, name: c.name, channel: c.channel, counting: used.has(c.id) })),
  });
});

router.post('/frames/:cameraId', edgeAuth, express.raw({ type: 'image/jpeg', limit: '3mb' }), async (req, res) => {
  const cam = await getCamera(req.edgeStoreId!, String(req.params.cameraId));
  if (!cam) throw notFound('Camera not found');
  const body = req.body as Buffer;
  if (!Buffer.isBuffer(body) || body.length < 1000 || body[0] !== 0xff || body[1] !== 0xd8) throw badRequest('Send one JPEG image as the body (Content-Type: image/jpeg).');
  const at = req.headers['x-captured-at'] ? new Date(String(req.headers['x-captured-at'])) : new Date();
  putEdgeFrame(cam.id, body, Number.isNaN(at.getTime()) || Math.abs(Date.now() - at.getTime()) > 10 * 60_000 ? new Date() : at);
  res.json({ ok: true });
});

export default router;
