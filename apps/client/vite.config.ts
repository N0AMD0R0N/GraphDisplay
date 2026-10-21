import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

// `/api/*` -> the API server (in Docker the client's nginx does the same)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://127.0.0.1:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
  build: { chunkSizeWarningLimit: 2500 },
});
