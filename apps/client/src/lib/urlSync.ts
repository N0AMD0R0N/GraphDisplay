import type { UrlState } from '../types';
import { buildUrl, parseUrlState } from './urlState';

const currentAddress = () => `${window.location.pathname}${window.location.search}${window.location.hash}`;

/** Reads the state from the address bar. */
export const readUrl = (): UrlState => parseUrlState(currentAddress());

let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Partial<UrlState> = {};

/**
 * Merges a change into the address bar (history.replaceState, so the back button is not flooded).
 * Writes are debounced: browsers throttle replaceState when it is called on every keystroke.
 * A key set to `undefined` is removed.
 */
export function writeUrl(patch: Partial<UrlState>): void {
  pending = { ...pending, ...patch };
  clearTimeout(timer);
  timer = setTimeout(() => {
    const next = buildUrl({ ...readUrl(), ...pending });
    pending = {};
    if (next !== currentAddress()) window.history.replaceState(null, '', next);
  }, 150);
}
