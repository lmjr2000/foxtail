/**
 * The Express app (no listening, no background jobs) so tests can drive it with supertest.
 *
 * Order matters: /api/auth and /api/edge have their own auth; everything else under /api requires a
 * signed-in user who has replaced any temporary password. Per-store routes are scoped by storeParam.
 */
import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HttpError } from './lib/http.js';
import { authenticate, requirePasswordChanged } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import edgeRoutes from './routes/edge.js';
import overviewRoutes from './routes/overview.js';
import peopleRoutes from './routes/people.js';
import storeRoutes from './routes/stores.js';
import { q } from './db/pool.js';

export function createApp(opts: { portalDir?: string | null } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback');

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', [
      "default-src 'self'", "img-src 'self' data: blob:", "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
      "script-src 'self' https://accounts.google.com/gsi/client", "frame-src https://accounts.google.com", "connect-src 'self' https://accounts.google.com/gsi/",
      "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'",
    ].join('; '));
    if (process.env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });

  app.get('/api/health', async (_req, res) => {
    await q('SELECT 1');
    res.json({ ok: true, version: process.env.APP_VERSION || 'dev' });
  });

  app.use('/api/edge', edgeRoutes);
  app.use('/api', express.json({ limit: '8mb' }));
  app.use('/api/auth', authRoutes);
  app.use('/api', authenticate, requirePasswordChanged);
  app.use('/api', overviewRoutes);
  app.use('/api', peopleRoutes);
  app.use('/api', storeRoutes);
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'NOT_FOUND', 'Not found')));

  // Built portal (production). Every non-API path gets index.html so client-side routes work.
  const portal = opts.portalDir === undefined ? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'portal', 'dist') : opts.portalDir;
  if (portal && existsSync(join(portal, 'index.html'))) {
    app.use(express.static(portal, { index: false, maxAge: '1h', setHeaders: (res, path) => { if (/[\\/]assets[\\/]/.test(path)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/).*/, (_req, res) => { res.setHeader('Cache-Control', 'no-cache'); res.sendFile(join(portal, 'index.html')); });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) });
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.too.large') { res.status(413).json({ error: 'TOO_LARGE', message: 'That upload is too large.' }); return; }
    if (e?.type === 'entity.parse.failed') { res.status(400).json({ error: 'VALIDATION_ERROR', message: 'The request body is not valid JSON.' }); return; }
    console.error('[api] unhandled error', err);
    res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Something went wrong on our side.' });
  });

  return app;
}
