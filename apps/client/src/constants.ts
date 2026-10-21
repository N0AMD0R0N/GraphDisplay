/** Constants of the web client. This file imports nothing, so vite.config.ts can use it as well. */

/** Prefix of the API on the page's own origin (the dev server and the nginx of the image proxy it to the API server). */
export const API_BASE = '/api';

/** Dev server (npm run dev:client). */
export const DEV_SERVER = { host: '127.0.0.1', port: 5173 } as const;

/** Where the dev server proxies `API_BASE` unless API_URL says otherwise. */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/**
 * The API is also reachable at the root, at the paths of openapi.yaml (docker/client.nginx.conf.template does the
 * same in the image). These paths always go to the API...
 */
export const API_ROOT_PATHS = /^\/(health|graphs|graphs\/[^/]+\/(schema|nodes|edges|view|view\/expand|links))\/?$/;
/** ...and these are shared with the UI's addresses: a page load gets the UI, every other request the API. */
export const UI_PAGE_PATHS = /^\/graphs\/[^/]+(\/routes\/query)?\/?$/;
export const DOCS_PATH = '/docs';

/** Size of a node on the canvas, in pixels (the server reserves the same box in its layout). */
export const NODE_SIZE = { width: 120, height: 56, dot: 26 } as const;

/** Distance between the rows of the routes drawn one below the other. */
export const ROUTE_GAP = 190;
