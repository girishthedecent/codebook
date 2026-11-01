import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [
    // The router plugin has to run before react so generated routes exist when JSX compiles.
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    port: 3000,
    // Same-origin in dev so the auth cookie is first-party and the backend's Origin check passes.
    proxy: {
      '/api': { target: 'http://localhost:4000', changeOrigin: false },
      '/openapi.json': { target: 'http://localhost:4000' },
    },
  },
  worker: { format: 'es' },
  build: {
    target: 'es2023',
    sourcemap: false,
    // The landing page has an entry of its own, so `/` never loads the app; the manifest tells
    // the prerender step which files that entry needs.
    manifest: true,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        landing: fileURLToPath(new URL('./src/landing.tsx', import.meta.url)),
      },
    },
  },
});
