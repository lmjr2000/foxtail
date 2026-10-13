/**
 * Tests run against real Postgres. In CI, DATABASE_URL points at the workflow's Postgres service.
 * Locally (no DATABASE_URL), an embedded Postgres is started in a temp folder and thrown away after.
 */
import type { TestProject } from 'vitest/node';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import pg from 'pg';

declare module 'vitest' {
  export interface ProvidedContext { databaseUrl: string }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

export default async function setup(project: TestProject) {
  if (process.env.DATABASE_URL) {
    project.provide('databaseUrl', process.env.DATABASE_URL);
    return;
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = mkdtempSync(join(tmpdir(), 'foxtail-pg-'));
  const port = await freePort();
  const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: false, onLog: () => {} });
  await server.initialise();
  await server.start();
  const admin = new pg.Client({ connectionString: `postgres://postgres:postgres@127.0.0.1:${port}/postgres` });
  await admin.connect();
  await admin.query('CREATE DATABASE foxtail_test');
  await admin.end();
  project.provide('databaseUrl', `postgres://postgres:postgres@127.0.0.1:${port}/foxtail_test`);
  return async () => {
    await server.stop();
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* Windows may hold files briefly */ }
  };
}
