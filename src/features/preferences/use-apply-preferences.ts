/**
 * Applies the store's `theme` preference to the document root so `tokens.css`'s
 * `:root[data-theme='dark']` token overrides (and its `color-scheme` toggle) take effect.
 * `'system'` is resolved through `window.matchMedia('(prefers-color-scheme: dark)')` rather
 * than written to the DOM literally, so `document.documentElement.dataset.theme` only ever
 * holds a concrete `'light' | 'dark'` — CSS never has to know a third state exists. Subscribes
 * to the media query's `change` event so a live OS theme flip (light -> dark while the app is
 * open) repaints immediately, not just on the next reload. No
 * `typeof window.matchMedia === 'function'` guard: every browser in PROJECT.md's target set
 * implements it, and `tests/setup.ts` is what supplies it in jsdom.
 *
 * Call once, from `App`.
 */
import { useEffect } from 'react';
import { useBoardStore, type Theme } from '@/state';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function resolveTheme(theme: Theme, systemPrefersDark: boolean): 'light' | 'dark' {
  if (theme === 'system') {
    return systemPrefersDark ? 'dark' : 'light';
  }
  return theme;
}

export function useApplyPreferences(): void {
  const theme = useBoardStore((state) => state.theme);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);

    function apply() {
      document.documentElement.dataset.theme = resolveTheme(theme, media.matches);
    }

    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);
}
