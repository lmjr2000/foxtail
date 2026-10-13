import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const omniBase = env.VITE_OMNI_API_BASE_URL || 'http://localhost:3001/api/v1';
  
  // Only set up proxy for dev server when we have an absolute URL
  const isAbsoluteUrl = omniBase.startsWith('http://') || omniBase.startsWith('https://');
  const omniOrigin = isAbsoluteUrl ? new URL(omniBase).origin : null;

  return {
    plugins: [react()],
    server: omniOrigin ? {
      proxy: {
        '/api/v1': { target: omniOrigin, changeOrigin: true },
        '/hls': { target: omniOrigin, changeOrigin: true },
      },
    } : {},
    build: {
      sourcemap: true,
    },
  };
});
