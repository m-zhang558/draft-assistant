/**
 * Collapsible "Insights" disclosure (MVP 4.10/4.11): houses the positional scarcity panel and
 * the bye-week collision panel, both read-only analytics over the active board. Defaults to
 * collapsed — under a 60-second pick clock the board itself is what matters (PROJECT.md §1), so
 * this never grows on its own.
 *
 * Placement: rendered in `App.tsx` directly below the filter/action toolbar row and above
 * `<Board />`'s wrapper, rather than a permanent side panel — a side panel would either shrink
 * the board's already-tight width on a laptop or need its own narrow-width disclosure anyway, so
 * one disclosure any width can use is simpler. It never competes with the board for the viewport
 * (PROJECT.md §8's scroll-ownership contract): `App`'s flex column keeps this `shrink-0` and
 * `<Board />`'s wrapper `flex-1 min-h-0 overflow-hidden`, so opening this only shrinks the space
 * `Board` has to work with — `Board` keeps scrolling its own region internally regardless, the
 * same way a `persistenceError` banner already does.
 */
import { useState } from 'react';
import { Button } from '@/ui';
import { ByeWeekPanel } from './bye-week-panel';
import { ScarcityPanel } from './scarcity-panel';

export function InsightsPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="shrink-0">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Hide insights' : 'Insights'}
      </Button>
      {open ? (
        <div className="mt-2 grid gap-4 rounded-md border border-border bg-surface p-3 sm:grid-cols-2">
          <ScarcityPanel />
          <ByeWeekPanel />
        </div>
      ) : null}
    </div>
  );
}
