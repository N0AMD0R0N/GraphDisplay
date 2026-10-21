import { buildSearch, parseUrlState, type UrlState } from './urlState';

/** Reads the state from the address bar. */
export const readUrl = (): UrlState => parseUrlState(window.location.search);

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
    const next = { ...readUrl(), ...pending };
    pending = {};
    const search = buildSearch(next);
    if (search !== window.location.search)
      window.history.replaceState(null, '', `${window.location.pathname}${search}`);
  }, 150);
}
