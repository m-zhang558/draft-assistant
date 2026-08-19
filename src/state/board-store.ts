/**
 * The single Zustand store backing the draft board. `createBoardStore` is a factory over an
 * injected `Storage` so tests can supply an in-memory fake; `useBoardStore` is the app
 * singleton wired to `window.localStorage`. Persisted changes are written through
 * `savePersistedState` via `store.subscribe` — not debounced, since writes are small and only
 * happen on commit (drag end, click), never per animation frame or per keystroke.
 *
 * Undo/redo (Phase 3.1): a snapshot is `{ activeFormat, boards }` — snapshotting `activeFormat`
 * too is deliberate. If you cross a player off in Redraft, switch to Dynasty, then hit undo,
 * restoring the format as well means the undo is always visible instead of silently changing a
 * board you are not looking at. Only destructive board edits (`toggleDrafted`, `clearDrafted`,
 * `resetOrder`, `moveVisible`, `importState`) push a snapshot; non-destructive view state
 * (`setFormat`, `setPosition`, `setSearch`, `setAvailableOnly`, `setTheme`, `setDensity`) does
 * not, so an undo after a misclick restores your board rather than toggling a filter back.
 * History itself is never persisted — an undo stack surviving a refresh would let you undo
 * edits from a session you can no longer see.
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  FORMATS,
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  EMPTY_HISTORY,
  initialOrder,
  moveInFilteredView,
  pushHistory,
  reconcileOrder,
  redoHistory,
  undoHistory,
  POSITION_FILTER_ALL,
  type Format,
  type History,
  type PositionFilter,
} from '@/domain';
import { getRankings } from './rankings';
import {
  DEFAULT_PREFERENCES,
  loadPersistedState,
  savePersistedState,
  STORAGE_SCHEMA_VERSION,
  type Density,
  type PersistedBoard,
  type PersistedState,
  type Theme,
} from './persistence';

export interface BoardSlice {
  order: string[];
  drafted: Set<string>;
}

/** What undo/redo snapshots: the destructive part of board state. See file header. */
interface BoardSnapshot {
  activeFormat: Format;
  boards: Record<Format, BoardSlice>;
}

export interface BoardStoreState {
  activeFormat: Format;
  boards: Record<Format, BoardSlice>;
  position: PositionFilter;
  search: string;
  availableOnly: boolean;
  theme: Theme;
  density: Density;

  /** Internal undo/redo stack. Part of state so zustand replaces it immutably on every mutation. */
  history: History<BoardSnapshot>;
  /** True when there is something to undo / redo. Kept in state so components subscribe to a boolean. */
  canUndo: boolean;
  canRedo: boolean;

  setFormat(format: Format): void;
  toggleDrafted(playerId: string): void;
  /** Active format only. */
  clearDrafted(): void;
  /** Active format only: back to baseRank order. */
  resetOrder(): void;
  /** `visibleIds` is the currently rendered, filtered id list. Delegates to moveInFilteredView. */
  moveVisible(visibleIds: readonly string[], fromIndex: number, toIndex: number): void;
  setPosition(position: PositionFilter): void;
  setSearch(query: string): void;
  setAvailableOnly(value: boolean): void;
  setTheme(theme: Theme): void;
  setDensity(density: Density): void;

  undo(): void;
  redo(): void;

  /** Replaces board state from an imported backup file (MVP 3.8). Undoable. */
  importState(state: PersistedState): void;
}

function buildInitialBoards(persisted: PersistedState | null): Record<Format, BoardSlice> {
  const boards = {} as Record<Format, BoardSlice>;

  for (const format of FORMATS) {
    const players = getRankings(format).players;
    const persistedBoard: PersistedBoard | undefined = persisted?.boards[format];
    const order = persistedBoard
      ? reconcileOrder(persistedBoard.order, players)
      : initialOrder(players);
    const drafted = new Set(persistedBoard?.drafted ?? []);
    boards[format] = { order, drafted };
  }

  return boards;
}

/** Reconciles every format's order/drafted from a persisted-shaped `boards` record. */
function reconcileBoards(boards: Record<Format, PersistedBoard>): Record<Format, BoardSlice> {
  const result = {} as Record<Format, BoardSlice>;
  for (const format of FORMATS) {
    const players = getRankings(format).players;
    const order = reconcileOrder(boards[format].order, players);
    const drafted = new Set(boards[format].drafted);
    result[format] = { order, drafted };
  }
  return result;
}

function toPersistedState(state: BoardStoreState): PersistedState {
  const boards = {} as Record<Format, PersistedBoard>;

  for (const format of FORMATS) {
    const slice = state.boards[format];
    boards[format] = { order: slice.order, drafted: Array.from(slice.drafted) };
  }

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeFormat: state.activeFormat,
    boards,
    filters: { position: state.position, availableOnly: state.availableOnly },
    preferences: { theme: state.theme, density: state.density },
  };
}

function snapshotOf(state: BoardStoreState): BoardSnapshot {
  return { activeFormat: state.activeFormat, boards: state.boards };
}

/** Factory so tests get an isolated store + fake Storage. No test-only API on the singleton. */
export function createBoardStore(storage: Storage): UseBoundStore<StoreApi<BoardStoreState>> {
  const persisted = loadPersistedState(storage);
  const preferences = persisted?.preferences ?? DEFAULT_PREFERENCES;

  const store = create<BoardStoreState>((set, get) => ({
    activeFormat: persisted?.activeFormat ?? 'redraft-ppr',
    boards: buildInitialBoards(persisted),
    position: persisted?.filters.position ?? POSITION_FILTER_ALL,
    search: '',
    availableOnly: persisted?.filters.availableOnly ?? true,
    theme: preferences.theme,
    density: preferences.density,

    history: EMPTY_HISTORY,
    canUndo: false,
    canRedo: false,

    setFormat(format) {
      set((state) => {
        const counts = getRankings(format).countsByPosition;
        const position =
          state.position === POSITION_FILTER_ALL || counts[state.position] > 0
            ? state.position
            : POSITION_FILTER_ALL;
        return { activeFormat: format, position };
      });
    },

    toggleDrafted(playerId) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = state.boards[state.activeFormat];
        const drafted = new Set(slice.drafted);
        if (drafted.has(playerId)) {
          drafted.delete(playerId);
        } else {
          drafted.add(playerId);
        }
        return {
          boards: { ...state.boards, [state.activeFormat]: { ...slice, drafted } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
    },

    clearDrafted() {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = state.boards[state.activeFormat];
        return {
          boards: { ...state.boards, [state.activeFormat]: { ...slice, drafted: new Set() } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
    },

    resetOrder() {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = state.boards[state.activeFormat];
        const order = initialOrder(getRankings(state.activeFormat).players);
        return {
          boards: { ...state.boards, [state.activeFormat]: { ...slice, order } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
    },

    moveVisible(visibleIds, fromIndex, toIndex) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = state.boards[state.activeFormat];
        const order = moveInFilteredView(slice.order, visibleIds, fromIndex, toIndex);
        return {
          boards: { ...state.boards, [state.activeFormat]: { ...slice, order } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
    },

    setPosition(position) {
      set({ position });
    },

    setSearch(query) {
      set({ search: query });
    },

    setAvailableOnly(value) {
      set({ availableOnly: value });
    },

    setTheme(theme) {
      set({ theme });
    },

    setDensity(density) {
      set({ density });
    },

    undo() {
      const state = get();
      const result = undoHistory(state.history, snapshotOf(state));
      if (result === null) {
        return;
      }
      set({
        activeFormat: result.present.activeFormat,
        boards: result.present.boards,
        history: result.history,
        canUndo: canUndoHistory(result.history),
        canRedo: canRedoHistory(result.history),
      });
    },

    redo() {
      const state = get();
      const result = redoHistory(state.history, snapshotOf(state));
      if (result === null) {
        return;
      }
      set({
        activeFormat: result.present.activeFormat,
        boards: result.present.boards,
        history: result.history,
        canUndo: canUndoHistory(result.history),
        canRedo: canRedoHistory(result.history),
      });
    },

    importState(imported) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const boards = reconcileBoards(imported.boards);
        return {
          activeFormat: imported.activeFormat,
          boards,
          position: imported.filters.position,
          availableOnly: imported.filters.availableOnly,
          theme: imported.preferences.theme,
          density: imported.preferences.density,
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
    },
  }));

  // `search` is deliberately not persisted, so a keystroke must not trigger a write: at ~865
  // player ids across both formats, serializing on every character is real work for no gain.
  // `history` is deliberately not persisted either (see file header), so it is excluded here too.
  // Guard on identity/value of the fields that actually round-trip.
  store.subscribe((state, prevState) => {
    if (
      state.boards === prevState.boards &&
      state.activeFormat === prevState.activeFormat &&
      state.position === prevState.position &&
      state.availableOnly === prevState.availableOnly &&
      state.theme === prevState.theme &&
      state.density === prevState.density
    ) {
      return;
    }
    savePersistedState(toPersistedState(state), storage);
  });

  return store;
}

/** App singleton, backed by window.localStorage. */
export const useBoardStore = createBoardStore(window.localStorage);
