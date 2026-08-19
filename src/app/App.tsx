/**
 * App shell: header (title + format switch + theme/density toggles), a filter/action
 * toolbar, the board, and a small provenance/count footer. No business logic lives here —
 * every child component reads the store itself (see phase2-contract.md §7).
 *
 * Layout contract for Phase 3.7's virtualised board: the outer wrapper is a full-viewport flex
 * column (`h-dvh`). `<header>` and the toolbar row are `shrink-0` — they never lose space to
 * the board. `<main>` is `flex-1 min-h-0 overflow-hidden`, so it never scrolls the page itself
 * and never grows past the viewport. The `<div>` immediately wrapping `<Board />` is
 * `min-h-0 flex-1 overflow-hidden` (NOT `overflow-y-auto` — deliberately, since Phase 3
 * pass 3): the virtualised list needs a ref to the exact element that scrolls, so `Board` owns
 * and scrolls its own `h-full overflow-y-auto` region internally rather than this wrapper
 * scrolling around an unvirtualised `<Board />`. This `<div>` just supplies the bounded height.
 */
import { Board, BoardActions, BoardIO } from '@/features/board';
import { AvailabilityToggle, PositionTabs, SearchBox } from '@/features/filters';
import { FORMAT_LABELS, FormatSwitch } from '@/features/format';
import { DensityToggle, ThemeToggle, useApplyPreferences } from '@/features/preferences';
import { getRankings, useBoardStore } from '@/state';

export function App() {
  useApplyPreferences();

  const activeFormat = useBoardStore((state) => state.activeFormat);
  const drafted = useBoardStore((state) => state.boards[state.activeFormat].drafted);

  const { players, provenance } = getRankings(activeFormat);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-muted">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <h1 className="text-xl font-semibold text-text-primary">Fantasy Assist</h1>
        <div className="flex flex-wrap items-center gap-3">
          <FormatSwitch />
          <ThemeToggle />
          <DensityToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4 sm:max-w-5xl sm:px-6 sm:py-6">
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <PositionTabs />
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox />
            <AvailabilityToggle />
            <BoardActions />
            <BoardIO />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <Board />
        </div>
        <footer className="shrink-0 text-xs text-text-muted">
          {FORMAT_LABELS[activeFormat]} — {players.length} players, {drafted.size} drafted · source:{' '}
          {provenance.source}
        </footer>
      </main>
    </div>
  );
}
