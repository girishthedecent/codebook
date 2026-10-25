import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { fileURLToPath } from 'node:url';

// Heavy libraries get their own chunks so they load only when a viewer or the graph opens.
const ownChunk: Record<string, string> = {
  'pdfjs-dist': 'pdf',
  shiki: 'shiki',
  '@shikijs': 'shiki',
  '@xyflow': 'flow',
};

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
    rollupOptions: {
      output: {
        manualChunks(id) {
          const m = /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?(@[^/]+|[^/]+)/.exec(id);
          return m ? ownChunk[m[1]!] : undefined;
        },
      },
    },
  },
});
