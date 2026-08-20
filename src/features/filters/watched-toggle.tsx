/** "Watched only" checkbox — hides everyone not on the watchlist (MVP 4.8). Mirrors
 * `availability-toggle.tsx` exactly; the two filters are independent and compose (both can be
 * on at once — `board.tsx` applies watchedOnly on top of `domain/filters.ts`'s
 * position/search/availableOnly). */
import { useBoardStore } from '@/state';

export function WatchedOnlyToggle() {
  const watchedOnly = useBoardStore((state) => state.watchedOnly);

  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        checked={watchedOnly}
        onChange={(event) => useBoardStore.getState().setWatchedOnly(event.target.checked)}
        className="h-4 w-4 rounded border-border accent-accent"
      />
      Watched only
    </label>
  );
}
