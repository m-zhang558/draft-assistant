/**
 * The shared column template, row-height maths, and responsive-column contract for the board.
 * Lives in its own module so `player-row.tsx`, `board.tsx`, and `use-virtual-rows.ts` all draw
 * from it, and so both `player-row.tsx` and `board.tsx` still export only a component
 * (`react-refresh/only-export-components`, and PROJECT.md §7 wants lint warning-free).
 *
 * Columns, in DOM order: drag handle, your rank, name, position, team, tier, bye, age, rank
 * delta, action. `board.tsx`'s legend and `player-row.tsx`'s row MUST render exactly these ten
 * columns in exactly this order, applying `NARROW_HIDDEN` to exactly the same five of them
 * (team, tier, bye, age, delta) — see "Responsive columns" below for why that keeps them in
 * lockstep rather than merely convention.
 *
 * --- Row height (MVP 3.4) ---
 *
 * Row height has exactly one source of truth: `resolveRowHeight` below. The virtualiser
 * (`use-virtual-rows.ts` / `virtual-window.ts`) positions rows by arithmetic (`index *
 * rowHeight`) and each row paints itself with an explicit inline `height` — if those two ever
 * disagreed, rows would overlap or gap. Both call this function; neither guesses at a height
 * via a Tailwind padding class.
 *
 * WCAG 2.5.5 / platform guidance wants interactive targets >= 44x44 CSS px. Below the `sm`
 * breakpoint the cross-off button is effectively the row's tap target, so the row height there
 * floors at `TOUCH_MIN_ROW_HEIGHT` even in compact density. `NARROW_QUERY` is how
 * `board.tsx` resolves that breakpoint in JS (via `ui/useMediaQuery`, same pattern as
 * `use-reduced-motion.ts`) — it is the exact width the `sm:` Tailwind variant below also
 * branches on, so the CSS and the virtualiser's arithmetic can never disagree about which
 * regime the board is in.
 *
 * --- Responsive columns (MVP 3.5) ---
 *
 * Below `sm` (640px) the grid drops from ten tracks to five (handle, rank, name, position,
 * action) via `ROW_GRID`'s `sm:` variant, and the five secondary columns are hidden — not
 * removed from markup — via `NARROW_HIDDEN`. `display: none` elements do not participate in
 * CSS grid layout, so the five columns that stay visible fill the narrow five-column template
 * in document order with no extra markup and no risk of the legend and the rows drifting
 * apart: both list the same ten spans, so both get the same five-column narrow layout for
 * free.
 */
import type { Density } from '@/state';

export const ROW_GRID =
  'grid grid-cols-[2rem_3rem_minmax(0,1fr)_3rem_4.5rem] items-center gap-2 ' +
  'sm:grid-cols-[2rem_3rem_minmax(0,1fr)_3rem_3rem_2.5rem_2.5rem_2.5rem_3.5rem_5rem]';

/** Applied to the team / tier / bye / age / rank-delta columns, in both the legend and the row. */
export const NARROW_HIDDEN = 'hidden sm:block';

/** Row height in CSS px at `>= sm` width, before the touch-target floor applies. */
const ROW_HEIGHTS: Record<Density, number> = {
  comfortable: 56,
  compact: 36,
};

/** WCAG 2.5.5 minimum interactive target size, in CSS px. */
export const TOUCH_MIN_ROW_HEIGHT = 44;

/** The same width `ROW_GRID`'s `sm:` variant branches on (Tailwind's default `sm` breakpoint). */
export const NARROW_QUERY = '(max-width: 639px)';

/** The single source of truth for row height — see file header. */
export function resolveRowHeight(density: Density, isNarrow: boolean): number {
  const base = ROW_HEIGHTS[density];
  return isNarrow ? Math.max(base, TOUCH_MIN_ROW_HEIGHT) : base;
}
