/**
 * The shared column template, row-height maths, and responsive-column contract for the board.
 * Lives in its own module so `player-row.tsx`, `board.tsx`, and `use-virtual-rows.ts` all draw
 * from it, and so both `player-row.tsx` and `board.tsx` still export only a component
 * (`react-refresh/only-export-components`, and PROJECT.md §7 wants lint warning-free).
 *
 * Columns, in DOM order at `>= sm`: drag handle, watch star (MVP 4.8), your rank, name, position,
 * team, tier, bye, age, rank delta, note (MVP 4.7), tier-break (MVP 4.9), action — thirteen
 * columns. `board.tsx`'s legend and `player-row.tsx`'s row MUST render exactly these thirteen in
 * exactly this order at `>= sm`, applying `NARROW_HIDDEN` to the same five inert columns (team,
 * tier, bye, age, delta) — see "Responsive columns" below for why that keeps them in lockstep
 * rather than merely convention.
 *
 * --- Below `sm`: note/tier-break become a JS-conditional swap, not a CSS one (Stage E fix) ---
 *
 * Stage D hid the note button and the tier-break button below `sm` with the same `NARROW_HIDDEN`
 * CSS class used for the inert text columns — which meant those two FEATURES simply did not
 * exist on a phone-width board, not merely looked different (PROJECT.md §3.5/§6: a feature absent
 * below a breakpoint is not acceptable). The fix is `player-row.tsx`'s `isNarrow` prop (computed
 * once in `board.tsx` via `ui/useMediaQuery(NARROW_QUERY)`, the exact same source of truth
 * `resolveRowHeight` already trusts): below `sm` the row renders a single `RowOverflowMenu` (one
 * "⋯" trigger opening a popover with the note editor and the tier-break toggle together) in place
 * of the direct note button + tier-break button, never both at once. This is a JS branch rather
 * than a second CSS-hidden copy on purpose: `jsdom` applies no stylesheet, so two simultaneously
 * *mounted* controls sharing an accessible name ("Add note for X") would be ambiguous both to a
 * test query and to any assistive tech that does not honour `display: none` in time. Team/tier/
 * bye/age/delta stay plain `NARROW_HIDDEN` text — they carry no interactive role, so CSS-only
 * hiding has no such ambiguity.
 *
 * Column counts still work out at each breakpoint despite the two DOM shapes: at `>= sm` the row
 * renders all 13 (the note button + tier-break button, matching the 13-track `sm:` template
 * below); below `sm` it renders 12 (5 of them CSS-`hidden`, so grid-invisible) plus the single
 * `RowOverflowMenu` node in the note/tier-break slot, for 7 grid-visible columns (handle, star,
 * rank, name, position, overflow, action) — matching the 7-track base template.
 *
 * --- Row information hierarchy (MVP 4.6-4.9 Stage D) ---
 *
 * The cross-off action button stays last, unchanged in size and position: it is the fastest
 * gesture on the row and the app's core loop (PROJECT.md §2), and nothing added here competes
 * with it for thumb reach. The watch star sits right after the drag handle — MVP 4.8 makes it a
 * primary, every-pick-cycle gesture (marking targets before/during a run on a position), so it
 * stays visible at every width, sized like the drag handle rather than to the 44px touch-target
 * minimum (matching the existing drag handle, which is held to the same non-44px standard — only
 * the cross-off button gets that treatment, as the one gesture that must never be fumbled).
 * Note and tier-break are pre-draft/context-setting features (jotting "hamstring, monitor
 * Thursday" or marking where your own tiers start) rather than a per-pick action, so — like team/
 * tier/bye/age/delta before them — they fold into `NARROW_HIDDEN` at the touch-target width: on
 * a 375px "second monitor" phone glance mid-draft they are not reachable, trading that off for
 * keeping `name` legible at that width (adding all three new columns at every width left ~40px
 * for player names on a 375px screen). At >= sm they are always visible, not tucked behind a
 * menu, because a single extra icon each is cheaper than a disclosure control and its own
 * keyboard trap to manage.
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
 * --- Responsive columns (MVP 3.5, extended Stage E) ---
 *
 * Below `sm` (640px) the grid drops from thirteen tracks to seven (handle, star, rank, name,
 * position, overflow, action) via `ROW_GRID`'s base (mobile-first) definition, and the five inert
 * secondary columns (team, tier, bye, age, delta) are hidden — not removed from markup — via
 * `NARROW_HIDDEN`. `display: none` elements do not participate in CSS grid layout, so the columns
 * that stay visible fill the narrow seven-column template in document order with no extra markup
 * and no risk of the legend and the rows drifting apart. The note/tier-break-vs-overflow swap is
 * the one exception to "hide via CSS, never remove from markup" — see the file header's Stage E
 * section for why that pair specifically is a JS conditional instead.
 */
import type { Density } from '@/state';

export const ROW_GRID =
  'grid grid-cols-[2rem_2rem_3rem_minmax(0,1fr)_3rem_2.5rem_4.5rem] items-center gap-2 ' +
  'sm:grid-cols-[2rem_2rem_3rem_minmax(0,1fr)_3rem_3rem_2.5rem_2.5rem_2.5rem_3.5rem_2.5rem_3rem_5rem]';

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
