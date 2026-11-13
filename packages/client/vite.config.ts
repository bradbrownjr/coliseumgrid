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
      // ws: the live connection (GET /api/live) is a WebSocket, which the proxy passes only when told to.
      '/api': { target: 'http://localhost:3000', ws: true },
    },
  },
});
