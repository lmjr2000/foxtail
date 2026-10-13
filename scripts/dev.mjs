/**
 * Local development: embedded Postgres + API (watch mode, port 3001) + portal (Vite, port 5173).
 *   npm run dev
 * Uses DATABASE_URL from the environment / .env if set, otherwise the embedded database in .data/pg.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEV_DATABASE_URL, startDevDb } from './dev-db.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Minimal .env loader (KEY=value lines); real environment variables win.
const envFile = join(root, '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  }
}

let db = null;
if (!process.env.DATABASE_URL) {
  db = await startDevDb();
  process.env.DATABASE_URL = DEV_DATABASE_URL;
  console.log(`[dev] embedded Postgres at ${DEV_DATABASE_URL}`);
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const kids = [
  spawn(npm, ['run', 'dev', '-w', '@foxtail/api'], { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
  spawn(npm, ['run', 'dev', '-w', '@foxtail/portal'], { cwd: root, stdio: 'inherit', env: process.env, shell: process.platform === 'win32' }),
];
console.log('[dev] portal: http://localhost:5173  (API on :3001)');

const stop = async () => {
  for (const k of kids) k.kill();
  if (db) await db.stop().catch(() => {});
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
