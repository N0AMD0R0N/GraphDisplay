import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { API_BASE, API_ROOT_PATHS, DEFAULT_API_URL, DEV_SERVER, DOCS_PATH, UI_PAGE_PATHS } from './src/constants';

const target = process.env.API_URL ?? DEFAULT_API_URL;

// The same routing as the client's nginx (docker/client.nginx.conf.template): the API under `API_BASE` and at the
// root, the API documentation at `DOCS_PATH`, and a page load of a UI address gets the UI.
const toApiAtRoot: ProxyOptions = {
  target,
  changeOrigin: true,
  bypass: (req) => {
    const path = (req.url ?? '').split('?')[0];
    if (API_ROOT_PATHS.test(path)) return undefined;
    if (UI_PAGE_PATHS.test(path) && !(req.headers.accept ?? '').includes('text/html')) return undefined;
    return '/index.html';
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.CLIENT_DEV_PORT) || DEV_SERVER.port,
    host: DEV_SERVER.host,
    proxy: {
      [API_BASE]: {
        target,
        changeOrigin: true,
        rewrite: (path) => path.replace(new RegExp(`^${API_BASE}`), ''),
      },
      [DOCS_PATH]: { target, changeOrigin: true },
      '^/(health|graphs)(/.*)?$': toApiAtRoot,
    },
  },
  build: { chunkSizeWarningLimit: 2500 },
});
