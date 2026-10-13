/**
 * GET /api/overview?range=&hours=                 every store in scope: totals, ranking, worst hours
 * GET /api/reports/all-stores.pdf|.csv?range=     the same as a download
 * For a franchise owner "every store" means their own stores; nothing about other stores is computed.
 */
import { Router } from 'express';
import { isCorporate } from '@foxtail/shared';
import { badRequest } from '../lib/http.js';
import { buildOverview } from '../services/overview.js';
import { allStoresCsv, allStoresPdf } from '../services/reports/all-stores-report.js';

const router = Router();

router.get('/overview', async (req, res) => {
  const o = await buildOverview(req.auth!, req.query.range, req.query.hours);
  if ('error' in o) throw badRequest(o.error);
  res.json(o);
});

for (const kind of ['pdf', 'csv'] as const) {
  router.get(`/reports/all-stores.${kind}`, async (req, res) => {
    const o = await buildOverview(req.auth!, req.query.range, req.query.hours);
    if ('error' in o) throw badRequest(o.error);
    const title = isCorporate(req.auth!.user.role) ? 'All stores' : 'My stores';
    const file = `foxtail-${title.toLowerCase().replace(/ /g, '-')}-${o.range.key.replace(/[^0-9a-z]+/gi, '-')}.${kind}`;
    res.setHeader('Content-Disposition', `attachment; filename="${file}"`);
    res.setHeader('Cache-Control', 'no-store');
    if (kind === 'pdf') res.type('application/pdf').send(allStoresPdf(o, title));
    else res.type('text/csv; charset=utf-8').send(allStoresCsv(o, title));
  });
}

export default router;
