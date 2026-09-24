/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Legacy workaround, disabled by default: if the API signs upload URLs for a host the browser cannot reach
  // (e.g. Docker-internal http://minio:9000), set VITE_UPLOAD_INTERNAL_ORIGIN and the dev server proxies PUTs
  // while forwarding the signed Host header. With S3_PUBLIC_ENDPOINT configured on the API this is not needed.
  const internalOrigin = env.VITE_UPLOAD_INTERNAL_ORIGIN || '';
  const proxyPath = env.VITE_UPLOAD_PROXY_PATH || '/__media-upload';
  const proxyTarget = env.VITE_UPLOAD_PROXY_TARGET || 'http://localhost:9000';
  const internalHost = internalOrigin ? new URL(internalOrigin).host : '';
  const uploadProxy = internalOrigin
    ? {
        [proxyPath]: {
          target: proxyTarget,
          changeOrigin: false,
          rewrite: (path: string) =>
            path.replace(new RegExp(`^${proxyPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), ''),
          configure: (proxy: {
            on: (
              event: 'proxyReq',
              cb: (proxyReq: { setHeader: (k: string, v: string) => void }) => void,
            ) => void;
          }) => {
            proxy.on('proxyReq', (proxyReq) => {
              proxyReq.setHeader('host', internalHost);
            });
          },
        },
      }
    : undefined;

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    server: {
      port: 5173,
      strictPort: true,
      proxy: uploadProxy,
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
