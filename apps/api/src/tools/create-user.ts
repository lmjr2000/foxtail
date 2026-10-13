/**
 * Create a login from the command line (the first corporate admin, or a recovery login).
 *   npm run user:create -w @foxtail/api -- --email you@example.com --name "Your Name" [--role corporate_admin]
 * Prints a temporary password once; the user must change it at first sign-in. No email is sent.
 */
import { isRole } from '@foxtail/shared';
import { closePool, runMigrations } from '../db/pool.js';
import { tempPassword } from '../lib/ids.js';
import { createUser, getUserRowByEmail } from '../services/users.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email');
  const role = arg('role') || 'corporate_admin';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Usage: --email you@example.com [--name "Name"] [--role corporate_admin|corporate_viewer]');
  if (!isRole(role) || role === 'franchise_owner') throw new Error('Use corporate_admin or corporate_viewer here; add franchise owners in the app.');
  await runMigrations();
  if (await getUserRowByEmail(email)) throw new Error(`A login for ${email} already exists.`);
  const password = tempPassword();
  const user = await createUser({ email, name: arg('name') || '', role, franchiseeId: null, password, mustChangePassword: true });
  console.log(`Created ${user.role} ${user.email}`);
  console.log(`Temporary password (shown once): ${password}`);
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exitCode = 1; }).finally(() => closePool());
