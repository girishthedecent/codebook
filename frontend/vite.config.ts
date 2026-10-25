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
  },
});
