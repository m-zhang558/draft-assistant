/**
 * Visually-hidden ARIA live region: announces `message` to assistive tech without being
 * visible on screen. Clipped (the "sr-only" technique) rather than `display: none` /
 * `visibility: hidden` — either of those removes the element from the accessibility tree, so
 * a screen reader would never announce it. Generic: it takes a string and knows nothing about
 * players or boards. Pass 3 (MVP 3.6) drives it with cross-off and reorder announcements.
 */
import type { JSX } from 'react';

export interface LiveRegionProps {
  message: string;
  politeness?: 'polite' | 'assertive';
  /**
   * Optional accessible name, rendered as `aria-label`. Only needed when a page renders more
   * than one `LiveRegion` at once (e.g. board reorder/cross-off vs. undo/redo vs. import/export)
   * and tests or assistive tech need to disambiguate them — omit it and behavior is unchanged.
   */
  label?: string;
}

export function LiveRegion({
  message,
  politeness = 'polite',
  label,
}: LiveRegionProps): JSX.Element {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      aria-label={label}
      className="absolute h-px w-px overflow-hidden whitespace-nowrap border-0 p-0"
      style={{ clip: 'rect(0, 0, 0, 0)', clipPath: 'inset(50%)', margin: '-1px' }}
    >
      {message}
    </div>
  );
}
