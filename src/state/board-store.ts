/**
 * The single Zustand store backing the draft board — Phase 4: multiple named boards, async
 * SQLite (OPFS) persistence via `state/db/`, fractional sort keys for O(1) reorders.
 *
 * --- Construction vs. hydration (Task 2 of the Phase 4 Stage C spec) ---
 *
 * `createBoardStore()` builds the store synchronously in `status: 'loading'` with NO boards and
 * NO database client — it must be constructible in `jsdom` (no `Worker`, no OPFS) and must never
 * touch storage. `initialiseBoardStore(store, client, storage)` is the actual boot sequence: it
 * opens the client, loads (or seeds) the database, reconciles every board against the current
 * dataset, reads settings, and flips the store to `status: 'ready'` — or `status: 'error'` with
 * `bootError` set, if anything in that sequence throws. `App` gates rendering on `status`; the
 * board must never paint over unhydrated state. `useBoardStore` is the app singleton, inert
 * until something calls `initialiseAppBoardStore()` (or, in tests, `initialiseBoardStore`
 * directly with an injected client/storage).
 *
 * --- Where the `DatabaseClient` lives ---
 *
 * `BoardStoreState` carries no `client` field — it is not UI-relevant state, and every component
 * that reads the store would otherwise need to know how to ignore it. Instead a module-level
 * `WeakMap<BoardStore, DatabaseClient>` associates a client with the store instance it was
 * initialised with; `initialiseBoardStore` registers it, every write-through action looks it up
 * via `requireClient`. Actions close over the store's own `store` binding (assigned by `const
 * store = create(...)` in `createBoardStore`) rather than receiving it as a parameter — safe
 * because an action's body only runs after that assignment has completed.
 *
 * --- Write-through and error surfacing (plan §4 rule 3) ---
 *
 * Every mutation updates memory SYNCHRONOUSLY inside `set(...)`, then fires its `DbCommand` at
 * the client and returns immediately — the UI never awaits a write. A rejected command sets
 * `persistenceError` (a message for `App`'s `role="alert"` banner) and otherwise does nothing:
 * no retry, no swallow, no fallback to `localStorage` (`PROJECT.md` §6; the MVP overview forbids
 * a silent downgrade explicitly). Memory is NOT rolled back on a rejection — the user's edit is
 * what they see on screen; silently reverting it out from under them because a write failed
 * would be worse than a visible "not saved" banner they can act on.
 *
 * --- Undo/redo (Phase 3.1, widened in Phase 4) ---
 *
 * A snapshot is `{ activeBoardId, boards }` — the FULL `BoardSlice` for every board that existed
 * when the snapshot was pushed. Widening the snapshot to cover notes/watch/tier-breaks (not just
 * order/drafted, as in Phase 3) is a deliberate change: those are board edits too, and a misclick
 * on a note deserves the same undo as a misclick on cross-off. `toggleDrafted`, `clearDrafted`,
 * `resetOrder`, `moveVisible`, `toggleWatched`, `setNote`, `toggleTierBreak`, and `importState`
 * push a snapshot; everything else (filters, theme, density, `setActiveBoard`) does not.
 * `clearTierBreaks` (Stage E) pushes exactly one snapshot for the whole clear, unlike looping
 * `toggleTierBreak`.
 *
 * Restoring a snapshot MERGES it into the current board set rather than replacing `boards`
 * wholesale: a board created after the snapshot was pushed is left untouched (it has no entry in
 * an older snapshot), and a board deleted since is not resurrected (its id is simply absent from
 * the current board set, so the merge skips it). This is what makes "board CRUD is not undoable"
 * actually true rather than true only until the next unrelated undo. Only boards whose slice
 * IDENTITY changed get a `replaceBoardRows` command — not every board on the snapshot.
 *
 * **Board CRUD (`createBoard`, `duplicateBoard`, `renameBoard`, `deleteBoard`) is deliberately
 * NOT undoable.** Creating/deleting a board is not a board *edit* the way a reorder or a note is;
 * an accidental delete wants a confirm dialog (Stage D), not an undo-stack entry silently sitting
 * behind forty other edits.
 *
 * History itself is never persisted — an undo stack surviving a refresh would let you undo edits
 * from a session you can no longer see. Capped at `HISTORY_LIMIT` (`domain/history.ts`).
 */
import { create, type StoreApi, type UseBoundStore } from 'zustand';
import {
  canRedo as canRedoHistory,
  canUndo as canUndoHistory,
  createBoardMeta,
  EMPTY_HISTORY,
  initialOrder,
  initialSortKeys,
  isPosition,
  keyBetween,
  moveInFilteredView,
  needsRenormalisation,
  nextBoardName,
  POSITION_FILTER_ALL,
  pushHistory,
  reconcileOrder,
  reconcileWithReport,
  redoHistory,
  renormalise,
  undoHistory,
  validateBoardName,
  type DatasetRefreshReport,
  type Format,
  type History,
  type PositionFilter,
} from '@/domain';
import {
  createBrowserDatabaseClient,
  DatabaseError,
  type BoardPlayerRow,
  type DatabaseClient,
  type DbCommand,
  type PersistedBoardRecord,
  type PersistedDatabase,
} from './db';
import { buildSeedCommands, readLegacyState } from './migrate-local-storage';
import {
  DEFAULT_PREFERENCES,
  isDensity,
  isTheme,
  STORAGE_KEY,
  type Density,
  type PersistedBoard,
  type PersistedState,
  type Theme,
} from './persistence';
import { getRankings } from './rankings';

/** One board's full content. `order` stays the single source of display order (every Phase 2/3
 * code path that reads it keeps working); `sortKeys` is the fractional key backing it, kept only
 * so a reorder can compute the next midpoint (`domain/fractional-order.ts`) without a full board
 * read. */
export interface BoardSlice {
  id: string;
  name: string;
  format: Format;
  createdAt: string;
  order: string[];
  sortKeys: Map<string, number>;
  drafted: Set<string>;
  watched: Set<string>;
  notes: Map<string, string>;
  /** Ids that START a custom tier band (MVP 4.9). */
  tierBreaks: Set<string>;
}

/** What undo/redo snapshots. See the file header. */
interface BoardHistorySnapshot {
  activeBoardId: string;
  boards: Record<string, BoardSlice>;
}

export interface BoardStoreState {
  status: 'loading' | 'ready' | 'error';
  /** Set only when `status === 'error'` — the boot failure's own message (e.g. OPFS unavailable
   * in private browsing). */
  bootError: string | null;
  /** Set when a write-through command was rejected — `App` renders it as a `role="alert"`
   * banner. There is no automatic clearing on a later successful write: this is a log of "the
   * last thing that went wrong", and dismissing it is a UI decision (Stage D), not the store's. */
  persistenceError: string | null;

  boardIds: string[];
  boards: Record<string, BoardSlice>;
  activeBoardId: string;

  position: PositionFilter;
  search: string;
  availableOnly: boolean;
  /** "Watched only" filter (MVP 4.8), alongside `availableOnly`. */
  watchedOnly: boolean;
  theme: Theme;
  density: Density;

  /** Internal undo/redo stack. Part of state so zustand replaces it immutably on every mutation. */
  history: History<BoardHistorySnapshot>;
  /** True when there is something to undo / redo. Kept in state so components subscribe to a boolean. */
  canUndo: boolean;
  canRedo: boolean;

  /** What the last dataset reconciliation found for each board (MVP 4.12), keyed by board id. */
  datasetReports: Record<string, DatasetRefreshReport>;
  /** True while the pre-Phase-4 `localStorage` key is still present — Stage D/E's one-click
   * "clear my old backup" affordance is offered exactly when this is true. */
  legacyBackupPresent: boolean;

  setActiveBoard(boardId: string): void;
  toggleDrafted(playerId: string): void;
  /** Active board only. */
  clearDrafted(): void;
  /** Active board only: back to baseRank order. */
  resetOrder(): void;
  /** `visibleIds` is the currently rendered, filtered id list. Delegates to moveInFilteredView. */
  moveVisible(visibleIds: readonly string[], fromIndex: number, toIndex: number): void;
  setPosition(position: PositionFilter): void;
  setSearch(query: string): void;
  setAvailableOnly(value: boolean): void;
  setWatchedOnly(value: boolean): void;
  toggleWatched(playerId: string): void;
  /** Empty string clears the note (stored as `null`, removed from the `notes` map) — an empty
   * string is not itself a note. */
  setNote(playerId: string, note: string): void;
  toggleTierBreak(playerId: string): void;
  /** Active board only: clears every custom tier break in ONE history entry (one
   * `replaceBoardRows` command) — Stage D's `board.tsx` looped `toggleTierBreak` per id instead,
   * which meant undoing a large reset took N presses; this is the Stage E fix. */
  clearTierBreaks(): void;
  setTheme(theme: Theme): void;
  setDensity(density: Density): void;

  undo(): void;
  redo(): void;

  /** Creates a board seeded from the dataset's own order, activates it, and returns its new id.
   * NOT undoable — see file header. */
  createBoard(name: string, format: Format): string;
  /** Copies another board's order/sortKeys/drafted/watched/notes/tierBreaks under a
   * collision-avoiding name (`domain/boards.ts` `nextBoardName`), activates the copy, and
   * returns its new id. NOT undoable. */
  duplicateBoard(boardId: string): string;
  renameBoard(boardId: string, name: string): void;
  /** Throws if `boardId` is the only remaining board — deletion never leaves zero boards.
   * Activates the next board in `boardIds` if the deleted board was active. NOT undoable. */
  deleteBoard(boardId: string): void;

  /** Replaces board state from an imported backup file (MVP 3.8). Undoable. See the multi-board
   * caveat on `importState`'s implementation below. */
  importState(state: PersistedState): void;
}

type BoardStore = UseBoundStore<StoreApi<BoardStoreState>>;

/** Associates a live store instance with the `DatabaseClient` it was initialised with. Not part
 * of `BoardStoreState` — see file header. */
const clientRegistry = new WeakMap<BoardStore, DatabaseClient>();

function requireClient(store: BoardStore): DatabaseClient {
  const client = clientRegistry.get(store);
  if (!client) {
    throw new Error(
      'board-store: no DatabaseClient registered for this store — call initialiseBoardStore ' +
        'before invoking any store action.'
    );
  }
  return client;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Fire-and-forget write-through: updates `persistenceError` on rejection, never throws, never
 * rolls memory back. See file header. */
function dispatch(store: BoardStore, command: DbCommand): void {
  requireClient(store)
    .send(command)
    .catch((error: unknown) => {
      store.setState({ persistenceError: describeError(error) });
    });
}

function dispatchAll(store: BoardStore, commands: DbCommand[]): void {
  if (commands.length === 0) {
    return;
  }
  requireClient(store)
    .sendAll(commands)
    .catch((error: unknown) => {
      store.setState({ persistenceError: describeError(error) });
    });
}

/** Selector helper: the currently active board. Every consumer that used to read
 * `state.boards[state.activeFormat]` now reads `activeBoard(state)`. Throws if `activeBoardId`
 * does not resolve — a legitimate state only while `status !== 'ready'`, which every caller must
 * already be gating on (`App` never renders a board before `ready`). */
export function activeBoard(state: BoardStoreState): BoardSlice {
  const board = state.boards[state.activeBoardId];
  if (!board) {
    throw new Error(`activeBoard: no board with id "${state.activeBoardId}" in state.boards.`);
  }
  return board;
}

function requireBoard(state: BoardStoreState, boardId: string): BoardSlice {
  const board = state.boards[boardId];
  if (!board) {
    throw new Error(`board-store: no board with id "${boardId}".`);
  }
  return board;
}

/** The position filter to carry into a board of `format`: unchanged unless the current filter
 * names a position that format ranks nobody at (e.g. K/DST on dynasty-sf), in which case it
 * falls back to `POSITION_FILTER_ALL`. Shared by `setActiveBoard` and by `createBoard`/
 * `duplicateBoard`, which activate the board they create. */
function resolvePositionForFormat(state: BoardStoreState, format: Format): PositionFilter {
  const counts = getRankings(format).countsByPosition;
  return state.position === POSITION_FILTER_ALL || counts[state.position] > 0
    ? state.position
    : POSITION_FILTER_ALL;
}

function requireSortKey(sortKeys: ReadonlyMap<string, number>, playerId: string): number {
  const key = sortKeys.get(playerId);
  if (key === undefined) {
    throw new Error(`board-store: no sort key for player "${playerId}".`);
  }
  return key;
}

function snapshotOf(state: BoardStoreState): BoardHistorySnapshot {
  return { activeBoardId: state.activeBoardId, boards: state.boards };
}

/** Converts a `BoardSlice` into the row set `createBoard`/`replaceBoardRows` expect. */
function toBoardPlayerRows(slice: BoardSlice): BoardPlayerRow[] {
  return slice.order.map((playerId) => ({
    playerId,
    sortOrder: requireSortKey(slice.sortKeys, playerId),
    drafted: slice.drafted.has(playerId),
    watched: slice.watched.has(playerId),
    tierBreak: slice.tierBreaks.has(playerId),
    note: slice.notes.get(playerId) ?? null,
  }));
}

/**
 * Reconciles one loaded `PersistedBoardRecord` against the current dataset (MVP 4.12). Returns
 * the resulting `BoardSlice`, the reconciliation report, and — only when something actually
 * changed — the corrected full row set to write back with `replaceBoardRows` (new players get
 * fresh keys from a full `renormalise`, since an insertion invalidates the old keys' positions
 * relative to it anyway).
 */
function reconcileRecordToSlice(record: PersistedBoardRecord): {
  slice: BoardSlice;
  report: DatasetRefreshReport;
  correctedRows: BoardPlayerRow[] | null;
} {
  const players = getRankings(record.format).players;
  const rowIds = record.rows.map((row) => row.playerId);
  const { order, report } = reconcileWithReport(rowIds, players);
  const rowsById = new Map(record.rows.map((row) => [row.playerId, row]));

  let sortKeys: Map<string, number>;
  let correctedRows: BoardPlayerRow[] | null = null;

  if (report.changed) {
    sortKeys = renormalise(order);
    correctedRows = order.map((playerId) => ({
      playerId,
      sortOrder: requireSortKey(sortKeys, playerId),
      drafted: rowsById.get(playerId)?.drafted ?? false,
      watched: rowsById.get(playerId)?.watched ?? false,
      tierBreak: rowsById.get(playerId)?.tierBreak ?? false,
      note: rowsById.get(playerId)?.note ?? null,
    }));
  } else {
    sortKeys = new Map(record.rows.map((row) => [row.playerId, row.sortOrder]));
  }

  const drafted = new Set<string>();
  const watched = new Set<string>();
  const tierBreaks = new Set<string>();
  const notes = new Map<string, string>();
  for (const playerId of order) {
    const existing = rowsById.get(playerId);
    if (!existing) continue;
    if (existing.drafted) drafted.add(playerId);
    if (existing.watched) watched.add(playerId);
    if (existing.tierBreak) tierBreaks.add(playerId);
    if (existing.note !== null) notes.set(playerId, existing.note);
  }

  const slice: BoardSlice = {
    id: record.id,
    name: record.name,
    format: record.format,
    createdAt: record.createdAt,
    order,
    sortKeys,
    drafted,
    watched,
    notes,
    tierBreaks,
  };

  return { slice, report, correctedRows };
}

// --- app_setting readers (boot step 5) --------------------------------------------------------
// A MISSING key is a normal cold start and takes the documented default. A PRESENT key that
// fails validation is corruption, not a reason to guess — throws DatabaseError, matching
// persistence.ts's fail-fast posture for the equivalent localStorage read.

function readActiveBoardId(settings: Record<string, string>, boardIds: readonly string[]): string {
  const value = settings.activeBoardId;
  if (value === undefined) {
    const first = boardIds[0];
    if (first === undefined) {
      throw new DatabaseError('board-store: database has no boards to activate.');
    }
    return first;
  }
  if (!boardIds.includes(value)) {
    throw new DatabaseError(
      `app_setting.activeBoardId ("${value}") does not match any loaded board id.`
    );
  }
  return value;
}

function readTheme(settings: Record<string, string>): Theme {
  const value = settings.theme;
  if (value === undefined) {
    return DEFAULT_PREFERENCES.theme;
  }
  if (!isTheme(value)) {
    throw new DatabaseError(`app_setting.theme has an unknown value: ${JSON.stringify(value)}.`);
  }
  return value;
}

function readDensity(settings: Record<string, string>): Density {
  const value = settings.density;
  if (value === undefined) {
    return DEFAULT_PREFERENCES.density;
  }
  if (!isDensity(value)) {
    throw new DatabaseError(`app_setting.density has an unknown value: ${JSON.stringify(value)}.`);
  }
  return value;
}

function readPositionFilter(settings: Record<string, string>): PositionFilter {
  const value = settings.filterPosition;
  if (value === undefined) {
    return POSITION_FILTER_ALL;
  }
  if (value === POSITION_FILTER_ALL || isPosition(value)) {
    return value;
  }
  throw new DatabaseError(
    `app_setting.filterPosition has an unknown value: ${JSON.stringify(value)}.`
  );
}

function readBooleanSetting(
  settings: Record<string, string>,
  key: string,
  defaultValue: boolean
): boolean {
  const value = settings[key];
  if (value === undefined) {
    return defaultValue;
  }
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new DatabaseError(
    `app_setting.${key} must be "true" or "false", got ${JSON.stringify(value)}.`
  );
}

/** Factory: builds the store in `status: 'loading'` with no boards and no client. Must not
 * throw and must not touch storage — see file header. */
export function createBoardStore(): BoardStore {
  const store = create<BoardStoreState>((set, get) => ({
    status: 'loading',
    bootError: null,
    persistenceError: null,

    boardIds: [],
    boards: {},
    activeBoardId: '',

    position: POSITION_FILTER_ALL,
    search: '',
    availableOnly: true,
    watchedOnly: false,
    theme: DEFAULT_PREFERENCES.theme,
    density: DEFAULT_PREFERENCES.density,

    history: EMPTY_HISTORY,
    canUndo: false,
    canRedo: false,

    datasetReports: {},
    legacyBackupPresent: false,

    setActiveBoard(boardId) {
      set((state) => {
        const board = requireBoard(state, boardId);
        return { activeBoardId: boardId, position: resolvePositionForFormat(state, board.format) };
      });
    },

    toggleDrafted(playerId) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        const drafted = new Set(slice.drafted);
        if (drafted.has(playerId)) {
          drafted.delete(playerId);
        } else {
          drafted.add(playerId);
        }
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, drafted } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'setDrafted',
        boardId: state.activeBoardId,
        playerId,
        drafted: activeBoard(state).drafted.has(playerId),
      });
    },

    clearDrafted() {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, drafted: new Set() } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'replaceBoardRows',
        boardId: state.activeBoardId,
        rows: toBoardPlayerRows(activeBoard(state)),
      });
    },

    resetOrder() {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        const order = initialOrder(getRankings(slice.format).players);
        const sortKeys = initialSortKeys(order);
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, order, sortKeys } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'replaceBoardRows',
        boardId: state.activeBoardId,
        rows: toBoardPlayerRows(activeBoard(state)),
      });
    },

    moveVisible(visibleIds, fromIndex, toIndex) {
      const state = get();
      const slice = activeBoard(state);
      const newOrder = moveInFilteredView(slice.order, visibleIds, fromIndex, toIndex);
      const movedId = visibleIds[fromIndex];
      if (movedId === undefined) {
        throw new RangeError(
          `moveVisible: fromIndex (${fromIndex}) is out of bounds for visibleIds.`
        );
      }

      const newIndex = newOrder.indexOf(movedId);
      const beforeId = newOrder[newIndex - 1];
      const afterId = newOrder[newIndex + 1];
      const beforeKey = beforeId !== undefined ? requireSortKey(slice.sortKeys, beforeId) : null;
      const afterKey = afterId !== undefined ? requireSortKey(slice.sortKeys, afterId) : null;

      let sortKeys: Map<string, number>;
      let command: DbCommand;
      if (needsRenormalisation(beforeKey, afterKey)) {
        sortKeys = renormalise(newOrder);
        command = {
          kind: 'renormaliseOrder',
          boardId: state.activeBoardId,
          keys: newOrder.map((id) => [id, requireSortKey(sortKeys, id)] as const),
        };
      } else {
        const newKey = keyBetween(beforeKey, afterKey);
        sortKeys = new Map(slice.sortKeys);
        sortKeys.set(movedId, newKey);
        command = {
          kind: 'moveSortKey',
          boardId: state.activeBoardId,
          playerId: movedId,
          sortOrder: newKey,
        };
      }

      const history = pushHistory(state.history, snapshotOf(state));
      const updatedSlice: BoardSlice = { ...slice, order: newOrder, sortKeys };
      set({
        boards: { ...state.boards, [state.activeBoardId]: updatedSlice },
        history,
        canUndo: canUndoHistory(history),
        canRedo: canRedoHistory(history),
      });
      dispatch(store, command);
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

    setWatchedOnly(value) {
      set({ watchedOnly: value });
    },

    toggleWatched(playerId) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        const watched = new Set(slice.watched);
        if (watched.has(playerId)) {
          watched.delete(playerId);
        } else {
          watched.add(playerId);
        }
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, watched } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'setWatched',
        boardId: state.activeBoardId,
        playerId,
        watched: activeBoard(state).watched.has(playerId),
      });
    },

    setNote(playerId, note) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        const notes = new Map(slice.notes);
        if (note === '') {
          notes.delete(playerId);
        } else {
          notes.set(playerId, note);
        }
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, notes } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'setNote',
        boardId: state.activeBoardId,
        playerId,
        note: activeBoard(state).notes.get(playerId) ?? null,
      });
    },

    toggleTierBreak(playerId) {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        const tierBreaks = new Set(slice.tierBreaks);
        if (tierBreaks.has(playerId)) {
          tierBreaks.delete(playerId);
        } else {
          tierBreaks.add(playerId);
        }
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, tierBreaks } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'setTierBreak',
        boardId: state.activeBoardId,
        playerId,
        tierBreak: activeBoard(state).tierBreaks.has(playerId),
      });
    },

    clearTierBreaks() {
      set((state) => {
        const history = pushHistory(state.history, snapshotOf(state));
        const slice = activeBoard(state);
        return {
          boards: { ...state.boards, [state.activeBoardId]: { ...slice, tierBreaks: new Set() } },
          history,
          canUndo: canUndoHistory(history),
          canRedo: canRedoHistory(history),
        };
      });
      const state = get();
      dispatch(store, {
        kind: 'replaceBoardRows',
        boardId: state.activeBoardId,
        rows: toBoardPlayerRows(activeBoard(state)),
      });
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
      applyHistorySnapshot(store, set, state, result);
    },

    redo() {
      const state = get();
      const result = redoHistory(state.history, snapshotOf(state));
      if (result === null) {
        return;
      }
      applyHistorySnapshot(store, set, state, result);
    },

    createBoard(name, format) {
      const validName = validateBoardName(name);
      const state = get();
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const order = initialOrder(getRankings(format).players);
      const slice: BoardSlice = {
        id,
        name: validName,
        format,
        createdAt,
        order,
        sortKeys: initialSortKeys(order),
        drafted: new Set(),
        watched: new Set(),
        notes: new Map(),
        tierBreaks: new Set(),
      };
      set({
        boards: { ...state.boards, [id]: slice },
        boardIds: [...state.boardIds, id],
        activeBoardId: id,
        position: resolvePositionForFormat(state, format),
      });
      dispatch(store, {
        kind: 'createBoard',
        board: createBoardMeta(id, validName, format, createdAt),
        rows: toBoardPlayerRows(slice),
      });
      return id;
    },

    duplicateBoard(boardId) {
      const state = get();
      const source = requireBoard(state, boardId);
      const id = crypto.randomUUID();
      const createdAt = new Date().toISOString();
      const existingNames = state.boardIds.map(
        (existingId) => requireBoard(state, existingId).name
      );
      const name = nextBoardName(existingNames, source.name);
      const slice: BoardSlice = {
        id,
        name,
        format: source.format,
        createdAt,
        order: [...source.order],
        sortKeys: new Map(source.sortKeys),
        drafted: new Set(source.drafted),
        watched: new Set(source.watched),
        notes: new Map(source.notes),
        tierBreaks: new Set(source.tierBreaks),
      };
      set({
        boards: { ...state.boards, [id]: slice },
        boardIds: [...state.boardIds, id],
        activeBoardId: id,
        position: resolvePositionForFormat(state, slice.format),
      });
      dispatch(store, {
        kind: 'createBoard',
        board: createBoardMeta(id, name, slice.format, createdAt),
        rows: toBoardPlayerRows(slice),
      });
      return id;
    },

    renameBoard(boardId, name) {
      const validName = validateBoardName(name);
      const state = get();
      const slice = requireBoard(state, boardId);
      set({ boards: { ...state.boards, [boardId]: { ...slice, name: validName } } });
      dispatch(store, { kind: 'renameBoard', boardId, name: validName });
    },

    deleteBoard(boardId) {
      const state = get();
      if (state.boardIds.length <= 1) {
        throw new Error('deleteBoard: cannot delete the only remaining board.');
      }
      requireBoard(state, boardId);

      const boardIds = state.boardIds.filter((id) => id !== boardId);
      const boards = { ...state.boards };
      delete boards[boardId];
      const datasetReports = { ...state.datasetReports };
      delete datasetReports[boardId];

      let activeBoardId = state.activeBoardId;
      if (activeBoardId === boardId) {
        const next = boardIds[0];
        if (next === undefined) {
          throw new Error('deleteBoard: no remaining board to activate.');
        }
        activeBoardId = next;
      }

      set({ boardIds, boards, datasetReports, activeBoardId });
      dispatch(store, { kind: 'deleteBoard', boardId });
    },

    importState(imported) {
      const state = get();
      const history = pushHistory(state.history, snapshotOf(state));
      const { boards, changedBoardIds } = applyImportedState(state, imported);
      const activeBoardId = boardIdForFormat(state, imported.activeFormat) ?? state.activeBoardId;

      set({
        boards,
        activeBoardId,
        position: imported.filters.position,
        availableOnly: imported.filters.availableOnly,
        theme: imported.preferences.theme,
        density: imported.preferences.density,
        history,
        canUndo: canUndoHistory(history),
        canRedo: canRedoHistory(history),
      });

      const commands: DbCommand[] = [];
      for (const boardId of changedBoardIds) {
        const slice = boards[boardId];
        if (slice) {
          commands.push({ kind: 'replaceBoardRows', boardId, rows: toBoardPlayerRows(slice) });
        }
      }
      dispatchAll(store, commands);
    },
  }));

  // `search` is deliberately never persisted (PROJECT.md §5): a keystroke must not trigger a
  // write. `history` is never persisted either (see file header). Only fires for genuine
  // post-boot changes — `prevState.status !== 'ready'` covers the loading -> ready transition
  // itself, which must not re-write the settings it just read.
  store.subscribe((state, prevState) => {
    if (prevState.status !== 'ready' || state.status !== 'ready') {
      return;
    }
    const commands: DbCommand[] = [];
    if (state.activeBoardId !== prevState.activeBoardId) {
      commands.push({ kind: 'setSetting', key: 'activeBoardId', value: state.activeBoardId });
    }
    if (state.theme !== prevState.theme) {
      commands.push({ kind: 'setSetting', key: 'theme', value: state.theme });
    }
    if (state.density !== prevState.density) {
      commands.push({ kind: 'setSetting', key: 'density', value: state.density });
    }
    if (state.position !== prevState.position) {
      commands.push({ kind: 'setSetting', key: 'filterPosition', value: state.position });
    }
    if (state.availableOnly !== prevState.availableOnly) {
      commands.push({
        kind: 'setSetting',
        key: 'filterAvailableOnly',
        value: String(state.availableOnly),
      });
    }
    if (state.watchedOnly !== prevState.watchedOnly) {
      commands.push({
        kind: 'setSetting',
        key: 'filterWatchedOnly',
        value: String(state.watchedOnly),
      });
    }
    dispatchAll(store, commands);
  });

  return store;
}

/**
 * Shared by `undo`/`redo`: merges a restored snapshot into the CURRENT board set (never
 * resurrecting a deleted board, never dropping one created since — see file header), then issues
 * `replaceBoardRows` only for boards whose slice identity actually changed.
 */
function applyHistorySnapshot(
  store: BoardStore,
  set: (partial: Partial<BoardStoreState>) => void,
  prevState: BoardStoreState,
  result: { history: History<BoardHistorySnapshot>; present: BoardHistorySnapshot }
): void {
  const boards: Record<string, BoardSlice> = { ...prevState.boards };
  for (const [boardId, slice] of Object.entries(result.present.boards)) {
    if (boardId in boards) {
      boards[boardId] = slice;
    }
  }
  const activeBoardId = boards[result.present.activeBoardId]
    ? result.present.activeBoardId
    : prevState.activeBoardId;

  set({
    activeBoardId,
    boards,
    history: result.history,
    canUndo: canUndoHistory(result.history),
    canRedo: canRedoHistory(result.history),
  });

  const commands: DbCommand[] = [];
  for (const [boardId, slice] of Object.entries(boards)) {
    if (prevState.boards[boardId] !== slice) {
      commands.push({ kind: 'replaceBoardRows', boardId, rows: toBoardPlayerRows(slice) });
    }
  }
  dispatchAll(store, commands);
}

/**
 * `importState` (MVP 3.8, unchanged file format) still carries exactly two format-keyed boards.
 * Under multi-board this is genuinely ambiguous — there can be more than one board of a given
 * format — so the honest, documented choice is: apply each imported format's order/drafted onto
 * the FIRST board of that format in `boardIds` order (the same board `board-io.tsx`'s export
 * treats as "the" board for that format). Every other board of the same format, and every board
 * of a format not represented in the import, is left untouched. This mirrors the limitation
 * `board-io.tsx` documents on export — see that file and the Stage C report.
 */
function applyImportedState(
  state: BoardStoreState,
  imported: PersistedState
): { boards: Record<string, BoardSlice>; changedBoardIds: string[] } {
  const boards = { ...state.boards };
  const changedBoardIds: string[] = [];

  for (const format of Object.keys(imported.boards) as Format[]) {
    const targetId = boardIdForFormat(state, format);
    if (targetId === undefined) continue;
    const target = requireBoard(state, targetId);
    const persistedBoard: PersistedBoard = imported.boards[format];
    const players = getRankings(format).players;
    const order = reconcileOrder(persistedBoard.order, players);
    const sortKeys = renormalise(order);
    const orderSet = new Set(order);
    const drafted = new Set(persistedBoard.drafted.filter((id) => orderSet.has(id)));
    boards[targetId] = { ...target, order, sortKeys, drafted };
    changedBoardIds.push(targetId);
  }

  return { boards, changedBoardIds };
}

/** The first board (in `boardIds` order) whose format matches `format`, or `undefined` if none. */
function boardIdForFormat(state: BoardStoreState, format: Format): string | undefined {
  return state.boardIds.find((id) => state.boards[id]?.format === format);
}

/**
 * Reconciles every board in a freshly loaded `PersistedDatabase` against the current dataset
 * (MVP 4.12), writes back any corrected rows, and flips `store` to `status: 'ready'` with the
 * result — the shared tail of both `initialiseBoardStore`'s boot sequence and
 * `importDatabaseBytes`'s `.sqlite` import (MVP 4.13, Stage E): the latter also hands
 * `client.importBytes()` a freshly loaded `PersistedDatabase` and needs the exact same
 * reconcile-and-activate step, not a second copy of it. `legacyBackupPresent` and
 * `persistenceError` are supplied by the caller because their sources differ (boot reads
 * `localStorage`; an in-session import has neither reason to change either one).
 */
function hydrateReadyState(
  store: BoardStore,
  db: PersistedDatabase,
  legacyBackupPresent: boolean,
  persistenceError: string | null
): DbCommand[] {
  const boards: Record<string, BoardSlice> = {};
  const datasetReports: Record<string, DatasetRefreshReport> = {};
  const corrections: DbCommand[] = [];

  for (const record of db.boards) {
    const { slice, report, correctedRows } = reconcileRecordToSlice(record);
    boards[record.id] = slice;
    datasetReports[record.id] = report;
    if (correctedRows) {
      corrections.push({ kind: 'replaceBoardRows', boardId: record.id, rows: correctedRows });
    }
  }

  const boardIds = db.boards.map((record) => record.id);
  const settings = db.settings;

  store.setState({
    status: 'ready',
    bootError: null,
    persistenceError,
    boardIds,
    boards,
    activeBoardId: readActiveBoardId(settings, boardIds),
    position: readPositionFilter(settings),
    search: '',
    availableOnly: readBooleanSetting(settings, 'filterAvailableOnly', true),
    watchedOnly: readBooleanSetting(settings, 'filterWatchedOnly', false),
    theme: readTheme(settings),
    density: readDensity(settings),
    history: EMPTY_HISTORY,
    canUndo: false,
    canRedo: false,
    datasetReports,
    legacyBackupPresent,
  });

  return corrections;
}

/**
 * The boot sequence (Task 2, §4 of the Stage C spec). Opens `client`, loads (seeding on a truly
 * empty database via `migrate-local-storage.ts`), reconciles every board against the current
 * dataset (MVP 4.12), reads settings, and flips `store` to `status: 'ready'`. Any throw anywhere
 * in this sequence — including OPFS being unavailable — flips it to `status: 'error'` instead,
 * with `bootError` naming the problem; nothing lower down catches it first. Legitimate public
 * API, not a test hook: calling it again re-hydrates the store from a fresh `open()`/`load()`.
 */
export async function initialiseBoardStore(
  store: BoardStore,
  client: DatabaseClient,
  storage: Storage
): Promise<void> {
  try {
    clientRegistry.set(store, client);

    await client.open();
    let db = await client.load();
    let legacyBackupPresent = false;
    let legacyError: string | null = null;

    if (db.boards.length === 0) {
      const legacy = readLegacyState(storage);
      legacyBackupPresent = legacy.legacyBackupPresent;
      legacyError = legacy.error;
      const seed = buildSeedCommands(legacy.persisted, {
        redraftPprId: crypto.randomUUID(),
        dynastySfId: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      });
      await client.sendAll(seed);
      db = await client.load();
    } else {
      legacyBackupPresent = storage.getItem(STORAGE_KEY) !== null;
    }

    const corrections = hydrateReadyState(store, db, legacyBackupPresent, legacyError);
    if (corrections.length > 0) {
      await client.sendAll(corrections);
    }
  } catch (error) {
    store.setState({
      status: 'error',
      bootError: describeError(error),
      persistenceError: null,
      boardIds: [],
      boards: {},
      activeBoardId: '',
      search: '',
      position: POSITION_FILTER_ALL,
      availableOnly: true,
      watchedOnly: false,
      history: EMPTY_HISTORY,
      canUndo: false,
      canRedo: false,
      datasetReports: {},
      legacyBackupPresent: false,
    });
  }
}

/** App singleton — inert until `initialiseAppBoardStore()` (or, in tests, `initialiseBoardStore`
 * with an injected client) is called. */
export const useBoardStore: BoardStore = createBoardStore();

/** Convenience for the real app: initialises the singleton against the real OPFS worker and
 * `window.localStorage`. `src/main.tsx` awaits this before rendering. */
export function initialiseAppBoardStore(): Promise<void> {
  return initialiseBoardStore(useBoardStore, createBrowserDatabaseClient(), window.localStorage);
}

// --- Raw `.sqlite` export/import (MVP 4.13, Stage E) ------------------------------------------
//
// `BoardStoreState` deliberately carries no `client` field (see the file header) — these two
// functions are the store's controlled seam for the raw byte image, mirroring
// `initialiseBoardStore`'s "standalone function taking `store`" shape rather than leaking
// `DatabaseClient` itself out to `features/board/board-io.tsx`.

/** Exports the currently open database's raw `.sqlite` byte image (`client.exportBytes()`).
 * Read-only: does not touch `store`'s state at all. `board-io.tsx` is expected to refuse this
 * while `persistenceError` is set — see that file for why an export taken then could silently
 * lag the last edit that failed to write through. */
export function exportDatabaseBytes(store: BoardStore): Promise<Uint8Array> {
  return requireClient(store).exportBytes();
}

/**
 * Replaces the ENTIRE database with `bytes` (`client.importBytes()`) and rehydrates `store` from
 * the result via the same `hydrateReadyState` tail `initialiseBoardStore` uses — so an imported
 * `.sqlite` file is reconciled against the current dataset (MVP 4.12) exactly as a normal boot
 * would reconcile it, and any correction is written back the same way.
 *
 * Unlike every other mutation in this file, this is NOT undoable (Ctrl+Z cannot restore a
 * database that no longer exists) and does not merge with the current board set the way
 * undo/redo's `applyHistorySnapshot` does — every board, not just the active one, is replaced,
 * and `hydrateReadyState` wipes the undo/redo history exactly as a fresh boot does (an old
 * snapshot could otherwise "restore" a board id that no longer exists in the new database, or
 * silently disagree with it). `board-io.tsx` is expected to gate the call behind an explicit
 * two-step confirmation (`ui/ConfirmButton` or equivalent) for exactly that reason.
 * `legacyBackupPresent` (the pre-Phase-4 `localStorage` key's presence, which importing a
 * `.sqlite` file does not touch) carries over from whatever the store already had.
 */
export async function importDatabaseBytes(store: BoardStore, bytes: Uint8Array): Promise<void> {
  const client = requireClient(store);
  const db: PersistedDatabase = await client.importBytes(bytes);
  const legacyBackupPresent = store.getState().legacyBackupPresent;
  const corrections = hydrateReadyState(store, db, legacyBackupPresent, null);
  if (corrections.length > 0) {
    await client.sendAll(corrections);
  }
}
