import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const omniBase = env.VITE_OMNI_API_BASE_URL || 'http://localhost:3001/api/v1';
  const omniOrigin = new URL(omniBase).origin;

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/v1': { target: omniOrigin, changeOrigin: true },
        '/hls': { target: omniOrigin, changeOrigin: true },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
