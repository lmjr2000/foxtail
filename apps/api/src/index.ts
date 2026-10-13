import { createApp } from './app.js';
import { jwtSecret } from './config.js';
import { closePool, runMigrations } from './db/pool.js';
import { startSampler, stopSampler } from './services/counting/sampler.js';
import { stopAllLive } from './services/video/live.js';
import { detectorConfigured } from './services/counting/detector.js';

async function main() {
  jwtSecret(); // refuse to start in production without a real secret
  await runMigrations();
  const port = Number(process.env.PORT || 3001);
  const server = createApp().listen(port, () => {
    console.log(`[foxtail] API listening on http://localhost:${port}`);
    if (!detectorConfigured()) console.log('[foxtail] person detection is not configured (ROBOFLOW_API_KEY, PERSON_MODEL_ID); counting will not run');
  });
  startSampler();
  const stop = () => {
    stopSampler();
    stopAllLive();
    server.close(() => { closePool().finally(() => process.exit(0)); });
    setTimeout(() => process.exit(0), 10_000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

main().catch(err => {
  console.error('[foxtail] failed to start:', err);
  process.exit(1);
});
