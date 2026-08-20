/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // @sqlite.org/sqlite-wasm ships a WASM binary loaded via its own relative
  // URL logic; Vite's dev-time dependency pre-bundler rewrites import paths
  // in a way that breaks that resolution, so it must be excluded from
  // pre-bundling (this only affects `npm run dev`, not `npm run build`).
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    css: true,
  },
});
