/**
 * The ranked player list: a semantic `<ul>` of `<li>` rows laid out on a CSS grid (dnd-kit
 * transforms on `<tr>` are unreliable — see phase2-contract.md §7), wrapped in dnd-kit's
 * DndContext/SortableContext for pointer + keyboard reordering.
 *
 * Self-sufficient: reads everything from the board store and `getRankings` directly, so
 * `App` stays a pure layout shell.
 *
 * Perf: only PRIMITIVE slices are selected from the zustand store (an existing array/Set
 * reference already living in state, never something freshly built inside the selector).
 * Everything derived (visible players, ranks, deltas, tier bands) goes through `useMemo`.
 *
 * --- Virtualisation (MVP 3.7) ---
 *
 * Dynasty SF is 439 rows; mounting a `useSortable` hook per row for all of them is real cost.
 * `useVirtualRows` (backed by the pure `computeWindow`) reports the inclusive index range that
 * should be mounted; rows outside it are neither rendered nor given a `useSortable` hook.
 * `SortableContext`'s `items` stays the FULL `visibleIds` list regardless — dnd-kit needs the
 * complete ordering to resolve a drop target correctly, and giving it only the rendered window
 * would desync reordering the moment you drag past the visible edge.
 *
 * Rows are absolutely positioned (`top: index * rowHeight`) inside a `<ul>` sized to the full
 * list height, rather than padded with spacer `<li>`s: a spacer would pollute
 * `getAllByRole('listitem')` and the list's screen-reader semantics, and would need its own
 * height bookkeeping identical to the row's — one more place the arithmetic could disagree
 * with the CSS. dnd-kit's transform composes correctly on top of the absolute position.
 *
 * `Board` now owns the scroll container itself (`ref={containerRef}`, from `useVirtualRows`)
 * rather than `App`'s wrapping div, because the virtualiser needs a ref to the exact element
 * that scrolls.
 * `App.tsx`'s wrapper changed from `overflow-y-auto` to `overflow-hidden` to match — see that
 * file's layout-contract comment. The column legend stays outside the scroll region so it does
 * not scroll away on a 400-row board.
 *
 * The `SortableContext`'s `restrictToParentElement` modifier is replaced with
 * `restrictToFirstScrollableAncestor`: under virtualisation the immediate DOM parent is a
 * sliver of the list (the windowed `<ul>`'s bounding box tracks only the mounted rows), and
 * `restrictToParentElement` would pin a drag to that sliver instead of the whole scrollable
 * list.
 *
 * --- Watchlist filter (MVP 4.8) ---
 *
 * `domain/filters.ts`'s `visiblePlayers`/`FilterCriteria` has no `watchedOnly` concept — only
 * `position`, `search`, `availableOnly` — so `watchedOnly` is applied here, on top of
 * `visiblePlayers`'s result, rather than inside `domain/`. That is a deliberate narrowing kept
 * IN this file rather than a `domain/` change (out of Stage D's scope; see the Stage D report).
 *
 * --- Custom tiers (MVP 4.9) ---
 *
 * `tierStartIds(visible)` is replaced with `resolveTierStarts(visible, tierBreaks)`: an empty
 * `tierBreaks` behaves exactly as before (inherits the source's own `tier` field), and any
 * custom break switches the WHOLE board to custom bands (`domain/tiers.ts`'s all-or-nothing
 * rule). The banner rendered when `tierBreaks.size > 0` is what makes that switch legible rather
 * than a silent behaviour change the next time a tier band moves.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { restrictToFirstScrollableAncestor, restrictToVerticalAxis } from '@dnd-kit/modifiers';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  POSITION_FILTER_ALL,
  rankDelta,
  rankIndex,
  resolveDragMove,
  resolveTierStarts,
  visiblePlayers,
  type FilterCriteria,
} from '@/domain';
import { activeBoard, getRankings, useBoardStore } from '@/state';
import { FORMAT_LABELS } from '@/features/boards';
import { Button, LiveRegion, useMediaQuery } from '@/ui';
import { PlayerRow } from './player-row';
import { NARROW_HIDDEN, NARROW_QUERY, ROW_GRID, resolveRowHeight } from './row-grid';
import { useVirtualRows } from './use-virtual-rows';

type EmptyReason = 'position' | 'drafted' | 'watched' | 'search';

/** `id` of the single shared keyboard-move instructions paragraph — one copy, not one per row. */
const INSTRUCTIONS_ID = 'board-row-move-instructions';

/**
 * Recomputes the currently rendered id list straight from store state at call time.
 *
 * The interaction handlers must not close over a rendered `visibleIds` array, or they go
 * stale (and `moveInFilteredView` would then silently move the wrong row rather than throw,
 * since a stale list is usually still an in-order subset). Deriving it here is one pass over
 * ~440 ids on a discrete user gesture — far cheaper than the class of bug it removes.
 *
 * Applies `watchedOnly` the same way the component's `visible` memo does (MVP 4.8) — see the
 * file header on why that filter is applied here rather than inside `domain/filters.ts`. Must
 * stay in lockstep with that memo or a move/drag would compute against a different id list than
 * what is actually rendered.
 */
function currentVisibleIds(): string[] {
  const state = useBoardStore.getState();
  const board = activeBoard(state);
  const { playersById } = getRankings(board.format);
  const filtered = visiblePlayers(board.order, playersById, board.drafted, {
    position: state.position,
    search: state.search,
    availableOnly: state.availableOnly,
  });
  const ids = state.watchedOnly
    ? filtered.filter((player) => board.watched.has(player.id))
    : filtered;
  return ids.map((player) => player.id);
}

function requireRank(ranks: ReadonlyMap<string, number>, playerId: string): number {
  const rank = ranks.get(playerId);
  if (rank === undefined) {
    throw new Error(`Board: no rank entry for player "${playerId}"`);
  }
  return rank;
}

/** Announcement text for the live region after a reorder (keyboard or drag) settles. */
function describeMove(playerId: string): string | null {
  const state = useBoardStore.getState();
  const board = activeBoard(state);
  const player = getRankings(board.format).playersById.get(playerId);
  const newRank = rankIndex(board.order).get(playerId);
  if (player === undefined || newRank === undefined) return null;
  return `${player.name} moved to rank ${newRank}.`;
}

/** Announcement text for the live region after a cross-off toggle. `nowDrafted` is the NEW state. */
function describeToggle(playerId: string, nowDrafted: boolean): string | null {
  const state = useBoardStore.getState();
  const player = getRankings(activeBoard(state).format).playersById.get(playerId);
  if (player === undefined) return null;
  return `${player.name} marked ${nowDrafted ? 'drafted' : 'available'}.`;
}

export function Board() {
  const activeFormat = useBoardStore((state) => activeBoard(state).format);
  const order = useBoardStore((state) => activeBoard(state).order);
  const drafted = useBoardStore((state) => activeBoard(state).drafted);
  const watched = useBoardStore((state) => activeBoard(state).watched);
  const notes = useBoardStore((state) => activeBoard(state).notes);
  const tierBreaks = useBoardStore((state) => activeBoard(state).tierBreaks);
  const position = useBoardStore((state) => state.position);
  const search = useBoardStore((state) => state.search);
  const availableOnly = useBoardStore((state) => state.availableOnly);
  const watchedOnly = useBoardStore((state) => state.watchedOnly);
  const density = useBoardStore((state) => state.density);

  const rankings = getRankings(activeFormat);
  const isNarrow = useMediaQuery(NARROW_QUERY);
  const rowHeight = resolveRowHeight(density, isNarrow);

  const [announcement, setAnnouncement] = useState('');

  // Focus restoration after a keyboard/drag move (MVP 3.7 + 3.6): the moved row can land
  // outside the virtualised window, unmounting the focused element. `pendingFocusIdRef` names
  // the player whose row should regain focus once it (re)mounts. Deliberately NOT a ref map
  // populated by a per-row callback prop: passing a ref-writing closure down as a custom prop
  // (rather than through the `ref` attribute itself) is exactly the pattern
  // `eslint-plugin-react-hooks`'s ref-safety analysis cannot verify is render-safe. Looking the
  // live node up by `data-player-id` from inside the effect below keeps every ref read where
  // the rule expects it — inside an effect, never threaded through render as a prop.
  const pendingFocusIdRef = useRef<string | null>(null);

  const criteria: FilterCriteria = useMemo(
    () => ({ position, search, availableOnly }),
    [position, search, availableOnly]
  );

  // Position/search/availability first (domain/filters.ts), then watchedOnly on top — see the
  // file header on why watchedOnly is not part of `criteria`/`visiblePlayers` itself.
  const filteredByCriteria = useMemo(
    () => visiblePlayers(order, rankings.playersById, drafted, criteria),
    [order, rankings.playersById, drafted, criteria]
  );

  const visible = useMemo(
    () =>
      watchedOnly
        ? filteredByCriteria.filter((player) => watched.has(player.id))
        : filteredByCriteria,
    [filteredByCriteria, watchedOnly, watched]
  );

  const visibleIds = useMemo(() => visible.map((player) => player.id), [visible]);

  const ranks = useMemo(() => rankIndex(order), [order]);

  // Tier bands (MVP 3.3, extended 4.9) are computed against the currently visible, ORDERED
  // list — the board shows YOUR order, and tiers can legitimately interleave after a reorder,
  // so a band start computed from the raw dataset order would be wrong the moment you drag a
  // player. `resolveTierStarts` folds in the board's own custom breaks (all-or-nothing — see
  // the file header) instead of always reading the source's `tier` field.
  const tierStarts = useMemo(() => resolveTierStarts(visible, tierBreaks), [visible, tierBreaks]);

  const rowData = useMemo(
    () =>
      visible.map((player) => {
        const rank = requireRank(ranks, player.id);
        return { player, rank, delta: rankDelta(rank, player.baseRank) };
      }),
    [visible, ranks]
  );

  const { containerRef, startIndex, endIndex, scrollToIndex } = useVirtualRows({
    rowCount: rowData.length,
    rowHeight,
  });

  // "Latest ref" pattern: handlers below need the current `scrollToIndex` but must themselves
  // stay referentially stable forever (PlayerRow's memoization depends on it), so they read
  // this ref rather than closing over the hook result directly.
  const scrollToIndexRef = useRef(scrollToIndex);
  useLayoutEffect(() => {
    scrollToIndexRef.current = scrollToIndex;
  });

  // After every render, if a move left a pending focus target, try to fulfil it: scroll the
  // row into view (already requested by the handler below) may take an extra render to mount
  // the row, so this keeps checking on every render rather than a one-shot effect. Abandons a
  // stale request if the player fell out of the visible list entirely (e.g. a filter change
  // raced the move) rather than leaving a dangling ref forever.
  useLayoutEffect(() => {
    const pendingId = pendingFocusIdRef.current;
    if (pendingId === null) return;
    if (!visibleIds.includes(pendingId)) {
      pendingFocusIdRef.current = null;
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    for (const row of container.querySelectorAll<HTMLLIElement>('li[data-player-id]')) {
      if (row.dataset.playerId === pendingId) {
        row.focus();
        pendingFocusIdRef.current = null;
        break;
      }
    }
  });

  // Actions are read via `useBoardStore.getState()` at call time rather than selected
  // reactively: they never change identity, and calling them as `getState().action(...)`
  // (an immediate member-call) keeps these handlers referentially stable forever.
  const handleMove = useCallback((playerId: string, direction: -1 | 1) => {
    const ids = currentVisibleIds();
    const fromIndex = ids.indexOf(playerId);
    if (fromIndex === -1) return;
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= ids.length) return;
    useBoardStore.getState().moveVisible(ids, fromIndex, toIndex);
    const message = describeMove(playerId);
    if (message) setAnnouncement(message);
    pendingFocusIdRef.current = playerId;
    scrollToIndexRef.current(toIndex);
  }, []);

  const handleToggleDrafted = useCallback((playerId: string) => {
    const state = useBoardStore.getState();
    const wasDrafted = activeBoard(state).drafted.has(playerId);
    state.toggleDrafted(playerId);
    const message = describeToggle(playerId, !wasDrafted);
    if (message) setAnnouncement(message);
  }, []);

  const handleToggleWatched = useCallback((playerId: string) => {
    const state = useBoardStore.getState();
    const board = activeBoard(state);
    const player = getRankings(board.format).playersById.get(playerId);
    const wasWatched = board.watched.has(playerId);
    state.toggleWatched(playerId);
    if (player) {
      setAnnouncement(`${player.name} ${wasWatched ? 'removed from' : 'added to'} watchlist.`);
    }
  }, []);

  const handleSetNote = useCallback((playerId: string, note: string) => {
    const state = useBoardStore.getState();
    const player = getRankings(activeBoard(state).format).playersById.get(playerId);
    state.setNote(playerId, note);
    if (player) {
      setAnnouncement(
        note.trim() === '' ? `Note cleared for ${player.name}.` : `Note saved for ${player.name}.`
      );
    }
  }, []);

  const handleToggleTierBreak = useCallback((playerId: string) => {
    const state = useBoardStore.getState();
    const board = activeBoard(state);
    const player = getRankings(board.format).playersById.get(playerId);
    const hadBreak = board.tierBreaks.has(playerId);
    state.toggleTierBreak(playerId);
    if (player) {
      setAnnouncement(
        hadBreak ? `Removed tier break at ${player.name}.` : `Tier now starts at ${player.name}.`
      );
    }
  }, []);

  // Clears every custom tier break (MVP 4.9) in ONE history entry via `clearTierBreaks` (Stage E)
  // — Stage D looped `toggleTierBreak` per id here instead, which meant undoing a large reset
  // took N presses rather than one.
  const handleResetCustomTiers = useCallback(() => {
    useBoardStore.getState().clearTierBreaks();
    setAnnouncement("Custom tiers cleared — showing the source rankings' own tiers.");
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    const ids = currentVisibleIds();
    const move = resolveDragMove(ids, String(active.id), over ? String(over.id) : null);
    if (move === null) return;
    useBoardStore.getState().moveVisible(ids, move.fromIndex, move.toIndex);
    const playerId = String(active.id);
    const message = describeMove(playerId);
    if (message) setAnnouncement(message);
    pendingFocusIdRef.current = playerId;
    scrollToIndexRef.current(move.toIndex);
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const emptyReason = useMemo<EmptyReason | null>(() => {
    if (visible.length > 0) return null;
    if (position !== POSITION_FILTER_ALL && rankings.countsByPosition[position] === 0) {
      return 'position';
    }
    // Checked before 'drafted': watchedOnly hiding everyone is the more specific explanation
    // when filteredByCriteria (position/search/availability, before watchedOnly) is non-empty.
    if (watchedOnly && filteredByCriteria.length > 0) {
      return 'watched';
    }
    if (availableOnly) {
      const ignoringAvailability = visiblePlayers(order, rankings.playersById, drafted, {
        position,
        search,
        availableOnly: false,
      });
      if (ignoringAvailability.length > 0) return 'drafted';
    }
    return 'search';
  }, [
    visible.length,
    position,
    rankings,
    watchedOnly,
    filteredByCriteria.length,
    availableOnly,
    order,
    drafted,
    search,
  ]);

  if (rowData.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface p-8 text-center text-sm text-text-muted">
        <BoardEmptyMessage
          reason={emptyReason}
          formatLabel={FORMAT_LABELS[activeFormat]}
          position={position}
          search={search}
        />
      </div>
    );
  }

  const windowed = rowData.slice(startIndex, endIndex + 1);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-md border border-border bg-surface">
      {/* Custom-tiers banner (MVP 4.9): makes the all-or-nothing switch (domain/tiers.ts
          resolveTierStarts) legible — without this, the bands silently stop matching the
          source's own tiers the moment the first custom break is set. */}
      {tierBreaks.size > 0 ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-muted px-3 py-1.5 text-xs text-text-muted">
          <span>
            Custom tiers · your bands replace {FORMAT_LABELS[activeFormat]}&apos;s own tiers.
          </span>
          <Button variant="ghost" size="sm" onClick={handleResetCustomTiers}>
            Reset to source tiers
          </Button>
        </div>
      ) : null}
      {/* Column legend. aria-hidden because each row already carries its own accessible
          label — a screen reader reading these headings per row would only add noise.
          shrink-0 + kept outside the scroll region below so it never scrolls away. */}
      <div
        aria-hidden="true"
        className={`${ROW_GRID} shrink-0 border-b border-border bg-surface px-3 py-2 text-xs font-medium text-text-muted`}
      >
        <span />
        <span>★</span>
        <span>Rank</span>
        <span>Player</span>
        <span>Pos</span>
        <span className={NARROW_HIDDEN}>Team</span>
        <span className={NARROW_HIDDEN}>Tier</span>
        <span className={NARROW_HIDDEN}>Bye</span>
        <span className={NARROW_HIDDEN}>Age</span>
        <span className={NARROW_HIDDEN}>vs exp.</span>
        {isNarrow ? (
          <span>More</span>
        ) : (
          <>
            <span>Note</span>
            <span>Tier break</span>
          </>
        )}
        <span />
      </div>
      {/* The single shared keyboard-move instructions, referenced by every row's
          aria-describedby — one copy for the whole list, not 400+ identical ones. */}
      <p id={INSTRUCTIONS_ID} className="sr-only">
        Press Alt+Up or Alt+Down to move this player one spot in your ranking. Use the drag handle
        to reorder with a pointer, or with the keyboard by pressing Space to lift, arrow keys to
        move, and Space again to drop.
      </p>
      <div ref={containerRef} className="min-h-0 flex-1 overflow-y-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToFirstScrollableAncestor]}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            <ul
              aria-label="Ranked players"
              style={{ position: 'relative', height: rowData.length * rowHeight }}
            >
              {windowed.map(({ player, rank, delta }, offset) => (
                <PlayerRow
                  key={player.id}
                  player={player}
                  rank={rank}
                  delta={delta}
                  drafted={drafted.has(player.id)}
                  watched={watched.has(player.id)}
                  note={notes.get(player.id)}
                  hasTierBreak={tierBreaks.has(player.id)}
                  index={startIndex + offset}
                  rowHeight={rowHeight}
                  isNarrow={isNarrow}
                  isTierStart={tierStarts.has(player.id)}
                  instructionsId={INSTRUCTIONS_ID}
                  onToggleDrafted={handleToggleDrafted}
                  onMove={handleMove}
                  onToggleWatched={handleToggleWatched}
                  onSetNote={handleSetNote}
                  onToggleTierBreak={handleToggleTierBreak}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
      <LiveRegion message={announcement} />
    </div>
  );
}

interface BoardEmptyMessageProps {
  reason: EmptyReason | null;
  formatLabel: string;
  position: FilterCriteria['position'];
  search: string;
}

/**
 * Distinguishes the reasons a filtered list can be empty (design note under MVP Phase 2,
 * extended 4.8): the format doesn't rank this position at all, everyone matching is drafted,
 * nobody matching is on the watchlist, or nothing matches the search text.
 */
function BoardEmptyMessage({ reason, formatLabel, position, search }: BoardEmptyMessageProps) {
  if (reason === 'position' && position !== POSITION_FILTER_ALL) {
    return (
      <p>
        {formatLabel} doesn&apos;t rank {position}.
      </p>
    );
  }
  if (reason === 'watched') {
    return (
      <p>
        Nobody matching your filters is on your watchlist. Turn off &quot;Watched only&quot; to see
        them.
      </p>
    );
  }
  if (reason === 'drafted') {
    return (
      <p>
        Everyone matching your filters has been drafted. Turn off &quot;Available only&quot; to see
        them.
      </p>
    );
  }
  return (
    <p>{search.trim() ? `No players match "${search}".` : 'No players match your filters.'}</p>
  );
}
