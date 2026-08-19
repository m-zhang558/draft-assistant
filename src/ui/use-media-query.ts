/**
 * Generic media-query subscription: returns whether `query` currently matches, and re-renders
 * on live changes (e.g. a window resize that crosses a breakpoint). Same shape as
 * `use-reduced-motion.ts` — it knows nothing about players or boards, so it belongs in `ui/`
 * (PROJECT.md §5: generic presentational primitives only).
 *
 * `features/board` (Phase 3.7, pass 3) uses this to resolve the touch-target row-height
 * breakpoint in JS, keyed to the same width as the CSS `sm` breakpoint the responsive column
 * layout branches on — so the virtualiser's arithmetic and the stylesheet can never disagree
 * about which width regime the board is in.
 */
import { useEffect, useState } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const media = window.matchMedia(query);

    function handleChange() {
      setMatches(media.matches);
    }

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [query]);

  return matches;
}
