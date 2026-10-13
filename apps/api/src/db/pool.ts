/**
 * Postgres pool and migration runner (carried over from Eye of Omni). Foxtail always needs a real
 * database: there is no in-memory fallback, so a number on screen is always a number in Postgres.
 */
import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: url, max: Number(process.env.DATABASE_POOL_MAX || 10) });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    const p = pool;
    pool = null;
    await p.end();
  }
}

/** Shorthand for one query on the shared pool. */
export async function q<T extends pg.QueryResultRow = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, values);
}

/** Run fn inside one transaction (rolled back on any error). */
export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function migrationsDir(): string {
  // src/db -> ../../migrations (dev) and dist/db -> ../../migrations (build)
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'migrations');
}

export async function runMigrations(): Promise<string[]> {
  const p = getPool();
  await p.query(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const files = readdirSync(migrationsDir()).filter(f => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const file of files) {
    const done = await p.query('SELECT 1 FROM schema_migrations WHERE id = $1', [file]);
    if (done.rowCount) continue;
    const sql = readFileSync(join(migrationsDir(), file), 'utf8');
    await tx(async c => {
      await c.query(sql);
      await c.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
    });
    applied.push(file);
    console.log(`[db] applied migration ${file}`);
  }
  return applied;
}
