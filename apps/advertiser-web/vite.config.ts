/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Presigned MinIO URLs are signed for the Docker-internal host (http://minio:9000). The browser cannot reach
  // that host, so in development we proxy PUTs through the dev server and forward the signed Host header.
  const internalOrigin = env.VITE_UPLOAD_INTERNAL_ORIGIN || 'http://minio:9000';
  const proxyPath = env.VITE_UPLOAD_PROXY_PATH || '/__media-upload';
  const proxyTarget = env.VITE_UPLOAD_PROXY_TARGET || 'http://localhost:9000';
  const internalHost = new URL(internalOrigin).host;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        [proxyPath]: {
          target: proxyTarget,
          changeOrigin: false,
          rewrite: (path) =>
            path.replace(new RegExp(`^${proxyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('host', internalHost);
            });
          },
        },
      },
    },
    build: {
      sourcemap: false,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'charts', test: /node_modules[\\/]recharts/ },
              { name: 'motion', test: /node_modules[\\/]framer-motion/ },
              { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/ },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./vitest.setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
      restoreMocks: true,
    },
  };
});
