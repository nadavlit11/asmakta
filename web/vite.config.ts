import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Dev: proxy API calls to the Fastify backend (default port 3011 in .env).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3011',
      '/health': 'http://localhost:3011',
    },
  },
});
