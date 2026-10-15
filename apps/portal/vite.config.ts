import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  // VITE_API_PROXY_TARGET sets the proxy target for /api/v1 requests (default: local API server)
  // VITE_OMNI_API_BASE_URL sets what the frontend uses for API calls (should be /api/v1 for proxy to work)
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://localhost:3001';
  const useProxy = proxyTarget.startsWith('http://') || proxyTarget.startsWith('https://');

  return {
    plugins: [react()],
    server: useProxy ? {
      proxy: {
        '/api/v1': { target: proxyTarget, changeOrigin: true },
        '/hls': { target: proxyTarget, changeOrigin: true },
      },
    } : {},
    build: {
      sourcemap: true,
    },
  };
});
