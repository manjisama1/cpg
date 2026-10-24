import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In dev, the browser talks to Vite (5173) and Vite forwards game traffic to the server (3001).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
      '/api': { target: 'http://localhost:3001' },
    },
  },
});
