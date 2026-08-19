/**
 * jsdom implements the DOM tree but performs no layout, implements no media queries, and does
 * not implement the Blob URL registry, so three shims live here:
 *
 * 1. `window.matchMedia` — jsdom does not implement it at all (`window.matchMedia` is
 *    `undefined`), and both `useApplyPreferences` (theme, Phase 3.4) and `useReducedMotion`
 *    (Phase 3.2) call it unconditionally by design: every browser in PROJECT.md's target set
 *    implements `matchMedia`, so a `typeof window.matchMedia === 'function'` guard in app code
 *    would only hide a broken environment, not handle a real one. `setMatchMediaQuery` below
 *    is the agreed test mechanism: a test declares which query currently matches, and every
 *    `MediaQueryList` for that query — already handed out, or constructed afterwards — reads
 *    that state and fires a `change` event at its listeners. This is how a test simulates a
 *    system theme flip or a `prefers-reduced-motion` change without a real browser. Pass 3's
 *    virtualisation tests do not need this one, but its reduced-motion tests will.
 *
 * 2. `HTMLElement.prototype.clientHeight` — jsdom performs no layout, so every element's
 *    `clientHeight` is always 0. A virtualised list (Phase 3.7, pass 3) that measures "how
 *    many rows fit in the viewport" from a zero-height container would compute zero and
 *    render nothing. This is a TEST-ENVIRONMENT SHIM ONLY, not a production fallback:
 *    application code must read the real `clientHeight` with no `|| 800` escape hatch of its
 *    own — a real browser always returns a real number, so a fallback there would only mask a
 *    bug. The non-zero default belongs here, where the environment (not the app) is the thing
 *    being worked around.
 *
 * 3. `URL.createObjectURL` / `URL.revokeObjectURL` — jsdom does not implement either (Phase
 *    3.8, pass 4): export (`board-io.tsx`) builds a `Blob` and downloads it via an object URL,
 *    and there is no real browser here to back one. The shim below is intentionally trivial —
 *    it does not need to produce a URL a test can actually fetch, only one that is a string (so
 *    `<a href>` assignment does not throw) and that `revokeObjectURL` can be asserted as having
 *    been called on, to prove the export path does not leak a blob URL.
 */
import '@testing-library/jest-dom/vitest';

type MediaQueryListener = (event: MediaQueryListEvent) => void;

const mediaQueryListeners = new Map<string, Set<MediaQueryListener>>();
const mediaQueryMatches = new Map<string, boolean>();

function listenersFor(query: string): Set<MediaQueryListener> {
  const existing = mediaQueryListeners.get(query);
  if (existing) return existing;
  const created = new Set<MediaQueryListener>();
  mediaQueryListeners.set(query, created);
  return created;
}

function createMediaQueryList(query: string): MediaQueryList {
  const list: MediaQueryList = {
    get matches() {
      return mediaQueryMatches.get(query) ?? false;
    },
    media: query,
    onchange: null,
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change') listenersFor(query).add(listener as MediaQueryListener);
    },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'change') listenersFor(query).delete(listener as MediaQueryListener);
    },
    addListener: (listener: MediaQueryListener | null) => {
      if (listener) listenersFor(query).add(listener);
    },
    removeListener: (listener: MediaQueryListener | null) => {
      if (listener) listenersFor(query).delete(listener);
    },
    dispatchEvent: () => true,
  };
  return list;
}

window.matchMedia = (query: string) => createMediaQueryList(query);

/**
 * Test-only control for the `window.matchMedia` shim above (see file header, shim 1). Sets
 * whether `query` currently matches, then fires a `change` event at every listener registered
 * for that exact query string — via `addEventListener('change', ...)` or the deprecated
 * `addListener` — including listeners on `MediaQueryList` objects handed out before this call.
 */
export function setMatchMediaQuery(query: string, matches: boolean): void {
  mediaQueryMatches.set(query, matches);
  const event = { matches, media: query } as MediaQueryListEvent;
  for (const listener of listenersFor(query)) {
    listener(event);
  }
}

Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
  configurable: true,
  value: 800,
});

let objectUrlCounter = 0;
URL.createObjectURL = () => `blob:mock-url-${(objectUrlCounter += 1)}`;
URL.revokeObjectURL = () => {};
