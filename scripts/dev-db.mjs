/**
 * Local Postgres for development, no install needed: an embedded Postgres 17 kept in .data/pg
 * (git-ignored). Prints the DATABASE_URL to use. Stop with Ctrl+C.
 *   npm run db:start
 */
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, '.data', 'pg');
const port = Number(process.env.DEV_DB_PORT || 54329);
export const DEV_DATABASE_URL = `postgres://foxtail:foxtail@127.0.0.1:${port}/foxtail`;

export async function startDevDb() {
  const fresh = !existsSync(join(dir, 'PG_VERSION'));
  mkdirSync(dir, { recursive: true });
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'foxtail', password: 'foxtail', port, persistent: true, onLog: () => {} });
  if (fresh) await server.initialise();
  await server.start();
  if (fresh) {
    const c = new pg.Client({ connectionString: `postgres://foxtail:foxtail@127.0.0.1:${port}/postgres` });
    await c.connect();
    await c.query('CREATE DATABASE foxtail');
    await c.end();
  }
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startDevDb();
  console.log(`Postgres running. DATABASE_URL=${DEV_DATABASE_URL}`);
  const stop = async () => { await server.stop(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
