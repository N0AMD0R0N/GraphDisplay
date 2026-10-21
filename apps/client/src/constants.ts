/** Constants of the web client. This file imports nothing, so vite.config.ts can use it as well. */

/** Prefix of the API on the page's own origin (the dev server and the nginx of the image proxy it to the API server). */
export const API_BASE = '/api';

/** Dev server (npm run dev:client). */
export const DEV_SERVER = { host: '127.0.0.1', port: 5173 } as const;

/** Where the dev server proxies `API_BASE` unless API_URL says otherwise. */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';

/** Size of a node on the canvas, in pixels (the server reserves the same box in its layout). */
export const NODE_SIZE = { width: 120, height: 56, dot: 26 } as const;

/** Distance between the rows of the routes drawn one below the other. */
export const ROUTE_GAP = 190;
