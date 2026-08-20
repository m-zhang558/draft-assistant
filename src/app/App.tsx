/**
 * App shell: header (title + board switch/manager + theme/density toggles), a filter/action
 * toolbar (now including the MVP 4.8 "Watched only" filter alongside "Available only"), the
 * collapsed-by-default `InsightsPanel` (MVP 4.10/4.11 — see that file for placement rationale),
 * the board, and a small provenance/count footer. No business logic lives here — every child
 * component reads the store itself (see phase2-contract.md §7).
 *
 * --- Boot gate (Phase 4 Stage C) ---
 *
 * The store starts in `status: 'loading'` (`board-store.ts`'s `createBoardStore`) and only
 * reaches `status: 'ready'` once `initialiseBoardStore`/`initialiseAppBoardStore` has opened the
 * database, seeded or reconciled it, and read settings. `App` gates its entire body on that:
 * `'loading'` renders a minimal centred shell, `'error'` renders a non-dismissible failure
 * panel, and only `'ready'` renders the board. The board must never paint over unhydrated store
 * state (plan §4 rule 1) — there is no partial/optimistic render of any of the three.
 *
 * A `persistenceError` (a write-through command that was rejected after boot) renders as a
 * `role="alert"` banner ABOVE the board in the `ready` state — visible, but not blocking: the
 * user's in-memory edits are still right there (`board-store.ts`'s write-through never rolls
 * memory back), only the write itself failed to reach storage.
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
import { Board, BoardActions, BoardIO, DatasetRefreshBanner } from '@/features/board';
import { BoardManager, BoardSwitch, FORMAT_LABELS } from '@/features/boards';
import { AvailabilityToggle, PositionTabs, SearchBox, WatchedOnlyToggle } from '@/features/filters';
import { InsightsPanel } from '@/features/insights';
import { DensityToggle, ThemeToggle, useApplyPreferences } from '@/features/preferences';
import { activeBoard, getRankings, useBoardStore } from '@/state';

function LoadingShell() {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-3 bg-surface-muted text-text-primary">
      <p className="text-sm text-text-muted">Loading your board…</p>
    </div>
  );
}

interface ErrorShellProps {
  bootError: string;
  legacyBackupPresent: boolean;
}

function ErrorShell({ bootError, legacyBackupPresent }: ErrorShellProps) {
  return (
    <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-surface-muted px-6 text-center">
      <div
        role="alert"
        className="max-w-md rounded-md border border-danger bg-surface p-6 text-sm text-text-primary"
      >
        <h1 className="mb-2 text-lg font-semibold text-danger">
          Fantasy Assist couldn&apos;t load
        </h1>
        <p className="mb-2">{bootError}</p>
        <p className="mb-2 text-text-muted">
          This usually means the browser refused to open its local database — private/incognito
          browsing windows commonly block this. Try a normal browsing window.
        </p>
        {legacyBackupPresent ? (
          <p className="text-text-muted">
            No data has been lost: your previous board is still saved in this browser&apos;s local
            storage.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function PersistenceErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="shrink-0 rounded-md border border-danger bg-surface px-3 py-2 text-sm text-danger"
    >
      Your last change could not be saved: {message}
    </div>
  );
}

export function App() {
  useApplyPreferences();

  const status = useBoardStore((state) => state.status);
  const bootError = useBoardStore((state) => state.bootError);
  const legacyBackupPresent = useBoardStore((state) => state.legacyBackupPresent);
  const persistenceError = useBoardStore((state) => state.persistenceError);
  const board = useBoardStore((state) => (state.status === 'ready' ? activeBoard(state) : null));

  if (status === 'loading') {
    return <LoadingShell />;
  }

  if (status === 'error') {
    return (
      <ErrorShell
        bootError={bootError ?? 'An unknown error occurred while loading the database.'}
        legacyBackupPresent={legacyBackupPresent}
      />
    );
  }

  if (!board) {
    // Unreachable in practice: `status === 'ready'` is set at the same time as `boards`/
    // `activeBoardId` in `initialiseBoardStore`, so a ready store always has an active board.
    throw new Error('App: store reports status "ready" but has no active board.');
  }

  const { players, provenance } = getRankings(board.format);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface-muted">
      <header className="flex shrink-0 flex-col gap-3 border-b border-border bg-surface px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:px-6 sm:py-4">
        <h1 className="text-xl font-semibold text-text-primary">Fantasy Assist</h1>
        <div className="flex flex-wrap items-center gap-3">
          <BoardSwitch />
          <BoardManager />
          <ThemeToggle />
          <DensityToggle />
        </div>
      </header>
      <main className="mx-auto flex w-full min-h-0 flex-1 flex-col gap-4 overflow-hidden px-4 py-4 sm:max-w-5xl sm:px-6 sm:py-6">
        {persistenceError ? <PersistenceErrorBanner message={persistenceError} /> : null}
        <DatasetRefreshBanner />
        <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <PositionTabs />
          <div className="flex flex-wrap items-center gap-3">
            <SearchBox />
            <AvailabilityToggle />
            <WatchedOnlyToggle />
            <BoardActions />
            <BoardIO />
          </div>
        </div>
        <InsightsPanel />
        <div className="min-h-0 flex-1 overflow-hidden">
          <Board />
        </div>
        <footer className="shrink-0 text-xs text-text-muted">
          {board.name} · {FORMAT_LABELS[board.format]} — {players.length} players,{' '}
          {board.drafted.size} drafted · source: {provenance.source}
        </footer>
      </main>
    </div>
  );
}
