/**
 * Generic reduced-motion detector, backed by `matchMedia('(prefers-reduced-motion: reduce)')`
 * and subscribed to live changes so a mid-session OS preference flip takes effect immediately.
 * It knows nothing about players, boards, or the app's preference store — see
 * `features/preferences/use-apply-preferences.ts` for the sibling hook that does — so it
 * belongs in `ui/` (PROJECT.md §5: generic presentational primitives only).
 *
 * `tokens.css`'s `prefers-reduced-motion` block handles CSS transitions/animations. It cannot
 * reach dnd-kit's reorder animation, which is driven from JavaScript: this hook is how a
 * dragging player row (Phase 3.7, pass 3) decides whether to animate its reorder transform.
 */
import { useEffect, useState } from 'react';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => window.matchMedia(REDUCED_MOTION_QUERY).matches);

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);

    function handleChange() {
      setReduced(media.matches);
    }

    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}
