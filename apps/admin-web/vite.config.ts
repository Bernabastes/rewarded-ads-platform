/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * Dev proxy so the browser can stay same-origin: run with `VITE_API_URL=/` and every `/api/*` call is forwarded
 * to the API (default http://localhost:3000, override with `VITE_DEV_PROXY_TARGET`). Lets the dev server run on a
 * port the API's CORS allow-list does not know about (e.g. 5176 while nginx holds 5174).
 */
const proxyTarget = process.env.VITE_DEV_PROXY_TARGET?.trim() || 'http://localhost:3000';
const apiProxy = { '/api': { target: proxyTarget, changeOrigin: true } };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(root, 'src') },
  },
  server: { port: 5174, strictPort: true, proxy: apiProxy },
  preview: { port: 5174, strictPort: true, proxy: apiProxy },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router'],
          query: ['@tanstack/react-query', '@tanstack/react-table', '@tanstack/react-virtual'],
          charts: ['recharts'],
          motion: ['framer-motion'],
          radix: [
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-select',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-tooltip',
            'cmdk',
            'sonner',
          ],
          forms: ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    css: false,
    restoreMocks: true,
    // Component tests drive real Radix primitives through userEvent; give them headroom on slow CI boxes.
    testTimeout: 15_000,
  },
});
