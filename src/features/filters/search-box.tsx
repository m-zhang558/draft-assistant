/**
 * Instant substring search over player name and team. Deliberately not persisted (see
 * `state/persistence.ts`) — a stale search box on refresh mid-draft is worse than useless.
 */
import { useBoardStore } from '@/state';

export function SearchBox() {
  const search = useBoardStore((state) => state.search);

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-1.5">
      <label htmlFor="player-search" className="sr-only">
        Search players by name or team
      </label>
      <input
        id="player-search"
        type="search"
        value={search}
        onChange={(event) => useBoardStore.getState().setSearch(event.target.value)}
        placeholder="Search name or team…"
        className="w-48 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
      />
      {search ? (
        <button
          type="button"
          onClick={() => useBoardStore.getState().setSearch('')}
          aria-label="Clear search"
          className="text-text-muted hover:text-text-primary"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
