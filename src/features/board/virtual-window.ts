/**
 * Pure windowing maths for the board's hand-rolled virtualisation (MVP 3.7).
 *
 * Dynasty SF is 439 rows; mounting a `useSortable` hook per row for all of them is the
 * board's main performance debt (see `docs/summary-reports/phase-2-core-interactivity.md`).
 * No new dependency: fixed-height windowing over a single scroll container is small enough,
 * and easier to reason about at the point it meets dnd-kit, to hand-roll rather than pull in a
 * library for (`PROJECT.md` §4 — the same judgement that dropped Playwright).
 *
 * `computeWindow` takes the scroll container's geometry and reports the inclusive range of row
 * indices that should be mounted, padded by `overscan` rows on each side so a fast scroll or a
 * drag's auto-scroll doesn't outrun mounted rows. It knows nothing about players, dnd-kit, or
 * React — pure and synchronous, unit-tested here rather than only exercised indirectly through
 * a rendered board, per PROJECT.md §6 ("domain logic gets unit tests").
 */

export interface VirtualWindow {
  /** First index to render, inclusive. */
  startIndex: number;
  /** Last index to render, inclusive. `endIndex < startIndex` means "render nothing". */
  endIndex: number;
}

export interface ComputeWindowArgs {
  /** The scroll container's `scrollTop`, in CSS px. Negative values are treated as 0. */
  scrollTop: number;
  /** The scroll container's `clientHeight`, in CSS px. */
  viewportHeight: number;
  /** Fixed row height, in CSS px (the single source of truth is `row-grid.ts`). */
  rowHeight: number;
  /** Total number of rows in the (filtered, ordered) list being windowed. */
  rowCount: number;
  /** Extra rows rendered beyond the visible range on each side. */
  overscan: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeWindow({
  scrollTop,
  viewportHeight,
  rowHeight,
  rowCount,
  overscan,
}: ComputeWindowArgs): VirtualWindow {
  if (rowCount <= 0) {
    return { startIndex: 0, endIndex: -1 };
  }

  const maxIndex = rowCount - 1;
  const clampedScrollTop = Math.max(0, scrollTop);

  // A scrollTop past the bottom of the list (stale measurement, or the list just shrank) must
  // clamp rather than compute an out-of-range index — this is the same "fail fast on a real
  // bug, but a stale scroll position is not one" judgement `board.tsx` applies to visibleIds.
  const firstVisible = clamp(Math.floor(clampedScrollTop / rowHeight), 0, maxIndex);
  const visibleRowCount = Math.max(1, Math.ceil(viewportHeight / rowHeight));
  const lastVisible = clamp(firstVisible + visibleRowCount - 1, 0, maxIndex);

  const startIndex = clamp(firstVisible - overscan, 0, maxIndex);
  const endIndex = clamp(lastVisible + overscan, 0, maxIndex);

  return { startIndex, endIndex };
}
