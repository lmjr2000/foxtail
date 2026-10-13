/**
 * The franchise-owner rule for every per-store route.
 *
 * Routers mounted under /api/stores/:storeId use storeParam(): it loads the store through the scoped
 * query and answers 404 when it is missing OR outside this login's scope, before any handler runs.
 * Handlers then read the store from req.store and never take a store id from anywhere else.
 * test/scoping.test.ts walks every registered :storeId route as the wrong franchise owner.
 */
import type { NextFunction, Request, Response } from 'express';
import { notFound, unauthorized } from '../lib/http.js';
import { scopedStore, type Store } from '../services/stores.js';

declare module 'express-serve-static-core' {
  interface Request {
    store?: Store;
  }
}

export function storeParam(req: Request, _res: Response, next: NextFunction, storeId: string): void {
  const load = async () => {
    if (!req.auth) throw unauthorized();
    const store = await scopedStore(req.auth, storeId);
    if (!store) throw notFound('Store not found');
    req.store = store;
  };
  load().then(() => next(), next);
}

/** The store loaded by storeParam (throws if a route forgot to mount it, so it can never be skipped silently). */
export function theStore(req: Request): Store {
  if (!req.store) throw new Error('Store route is missing the scoped :storeId loader');
  return req.store;
}
