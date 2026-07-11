import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy API calls to the Fastify backend. PORT defaults to 3000
// (src/config/env.ts + .env.example); override VITE_PROXY_TARGET to match.
const target = process.env.VITE_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': target,
      '/health': target,
    },
  },
});
