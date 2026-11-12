import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
  },
  server: {
    // The server (packages/server) listens on 3000; the dev client forwards /api to it.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
