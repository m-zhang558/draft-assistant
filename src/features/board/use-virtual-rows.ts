/**
 * DOM half of the board's hand-rolled virtualisation (MVP 3.7). Owns the scroll container ref,
 * `scrollTop`, and the viewport height, and turns them into a rendered index range via the
 * pure `computeWindow`. The maths lives in `virtual-window.ts`, unit-tested without a DOM; this
 * hook is the thin, deliberately untested-by-unit-test DOM wiring around it.
 *
 * Deliberately no `ResizeObserver` — jsdom does not implement it (see `tests/setup.ts`), and a
 * window `resize` listener covers every real case that changes this container's height (the
 * board fills a flex region sized by the viewport; nothing but a window resize changes that).
 *
 * Scroll-driven updates are throttled to at most one state update per animation frame, so a
 * fast flick across a 439-row board does not queue one React render per native scroll event.
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { computeWindow, type VirtualWindow } from './virtual-window';

export interface UseVirtualRowsArgs {
  /** Total number of rows in the (filtered, ordered) list being windowed. */
  rowCount: number;
  /** Fixed row height, in CSS px — the single source of truth lives in `row-grid.ts`. */
  rowHeight: number;
  /** Extra rows rendered beyond the visible range on each side. Defaults to 6. */
  overscan?: number;
}

export interface UseVirtualRowsResult extends VirtualWindow {
  /** Attach to the scrolling element. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /**
   * Imperatively scrolls the container so row `index` is within view (a no-op if it already
   * is), then immediately recomputes the rendered window against the new scroll position —
   * without waiting for the throttled scroll-event path — so a caller that focuses that row
   * right after does not have to wait an extra frame for it to exist.
   *
   * Typed as an arrow-function property (not a method shorthand) so consumers can hold onto
   * it — e.g. in a "latest ref" — without `@typescript-eslint/unbound-method` treating it as a
   * method that might implicitly depend on `this`.
   */
  scrollToIndex: (index: number) => void;
}

const DEFAULT_OVERSCAN = 6;

export function useVirtualRows({
  rowCount,
  rowHeight,
  overscan = DEFAULT_OVERSCAN,
}: UseVirtualRowsArgs): UseVirtualRowsResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const scrollFrameRef = useRef<number | null>(null);

  const measure = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    setViewportHeight(node.clientHeight);
  }, []);

  // Runs before paint so the first real render already has a non-zero viewport height instead
  // of flashing an empty window for one frame.
  useLayoutEffect(() => {
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [measure]);

  useLayoutEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    function handleScroll() {
      if (scrollFrameRef.current !== null) return;
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const current = containerRef.current;
        if (current) setScrollTop(current.scrollTop);
      });
    }

    node.addEventListener('scroll', handleScroll);
    return () => {
      node.removeEventListener('scroll', handleScroll);
      if (scrollFrameRef.current !== null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, []);

  const scrollToIndex = useCallback(
    (index: number) => {
      const node = containerRef.current;
      if (!node) return;

      const rowTop = index * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const viewTop = node.scrollTop;
      const viewBottom = viewTop + node.clientHeight;

      let nextScrollTop = viewTop;
      if (rowTop < viewTop) {
        nextScrollTop = rowTop;
      } else if (rowBottom > viewBottom) {
        nextScrollTop = rowBottom - node.clientHeight;
      } else {
        return; // already fully in view
      }

      node.scrollTop = nextScrollTop;
      setScrollTop(node.scrollTop);
    },
    [rowHeight]
  );

  const { startIndex, endIndex } = computeWindow({
    scrollTop,
    viewportHeight,
    rowHeight,
    rowCount,
    overscan,
  });

  return { containerRef, startIndex, endIndex, scrollToIndex };
}
