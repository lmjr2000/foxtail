import { closePool, runMigrations } from './pool.js';

runMigrations()
  .then(applied => console.log(applied.length ? `Applied ${applied.length} migration(s).` : 'Database is up to date.'))
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => closePool());
