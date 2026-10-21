import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { API_BASE, DEFAULT_API_URL, DEV_SERVER } from './src/constants';

// `API_BASE/*` -> the API server (in Docker the client's nginx does the same)
export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_DEV_PORT) || DEV_SERVER.port,
    host: DEV_SERVER.host,
    proxy: {
      [API_BASE]: {
        target: process.env.API_URL ?? DEFAULT_API_URL,
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${API_BASE}`), ''),
      },
    },
  },
  build: { chunkSizeWarningLimit: 2500 },
});
