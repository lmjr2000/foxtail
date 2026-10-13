import { inject } from 'vitest';

process.env.DATABASE_URL = inject('databaseUrl');
process.env.NODE_ENV = 'test';
process.env.INSIGHTS_CACHE_MS = '0';
process.env.SAMPLER_ENABLED = 'false';
delete process.env.ROBOFLOW_API_KEY;
delete process.env.GOOGLE_CLIENT_ID;
