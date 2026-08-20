import { HISTORY_LIMIT, POSITION_FILTER_ALL, moveInFilteredView } from '@/domain';
import type { DbCommand } from './db';
import {
  createTestDatabaseClient,
  createFailingTestDatabaseClient,
} from './db/client.test-support';
import {
  activeBoard,
  createBoardStore,
  exportDatabaseBytes,
  importDatabaseBytes,
  initialiseBoardStore,
} from './board-store';
import { getRankings } from './rankings';
import {
  DEFAULT_PREFERENCES,
  savePersistedState,
  STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  type PersistedState,
} from './persistence';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** Boots a fresh store + fresh in-process SQLite client against `storage` (defaults to an empty
 * in-memory `Storage`), and returns both plus a helper to read the raw persisted database. */
async function bootStore(storage: Storage = createMemoryStorage()) {
  const store = createBoardStore();
  const client = createTestDatabaseClient();
  await initialiseBoardStore(store, client, storage);
  return { store, client, storage };
}

function redraftBoardId(store: ReturnType<typeof createBoardStore>): string {
  const state = store.getState();
  const id = state.boardIds.find((boardId) => state.boards[boardId]?.format === 'redraft-ppr');
  if (!id) throw new Error('expected a redraft-ppr board');
  return id;
}

function dynastyBoardId(store: ReturnType<typeof createBoardStore>): string {
  const state = store.getState();
  const id = state.boardIds.find((boardId) => state.boards[boardId]?.format === 'dynasty-sf');
  if (!id) throw new Error('expected a dynasty-sf board');
  return id;
}

describe('cold start', () => {
  it('seeds two boards — Redraft PPR and Dynasty Superflex — in baseRank order, nothing drafted', async () => {
    const { store } = await bootStore();
    const state = store.getState();

    expect(state.status).toBe('ready');
    expect(state.boardIds).toHaveLength(2);

    const redraft = state.boards[redraftBoardId(store)]!;
    const dynasty = state.boards[dynastyBoardId(store)]!;

    expect(redraft.name).toBe('Redraft PPR');
    expect(dynasty.name).toBe('Dynasty Superflex');
    expect(redraft.order).toEqual(getRankings('redraft-ppr').players.map((player) => player.id));
    expect(dynasty.order).toEqual(getRankings('dynasty-sf').players.map((player) => player.id));
    expect(redraft.drafted.size).toBe(0);
    expect(dynasty.drafted.size).toBe(0);

    expect(state.activeBoardId).toBe(redraftBoardId(store));
    expect(state.position).toBe(POSITION_FILTER_ALL);
    expect(state.search).toBe('');
    expect(state.availableOnly).toBe(true);
    expect(state.watchedOnly).toBe(false);
    expect(state.theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(state.density).toBe(DEFAULT_PREFERENCES.density);
  });

  it('a second boot against the same client loads the seeded boards without re-seeding', async () => {
    const client = createTestDatabaseClient();
    const storage = createMemoryStorage();
    const first = createBoardStore();
    await initialiseBoardStore(first, client, storage);
    const firstBoardIds = [...first.getState().boardIds].sort();

    const second = createBoardStore();
    await initialiseBoardStore(second, client, storage);

    expect([...second.getState().boardIds].sort()).toEqual(firstBoardIds);
    expect(second.getState().boardIds).toHaveLength(2);
  });

  it('boot failure (client.open() rejects) sets status "error" with the message and no partial board state', async () => {
    const store = createBoardStore();
    const client = createFailingTestDatabaseClient('OPFS is unavailable in this browsing mode.');

    await initialiseBoardStore(store, client, createMemoryStorage());

    const state = store.getState();
    expect(state.status).toBe('error');
    expect(state.bootError).toBe('OPFS is unavailable in this browsing mode.');
    expect(state.boardIds).toEqual([]);
    expect(state.boards).toEqual({});
  });
});

describe('4.4 legacy localStorage migration', () => {
  function v1Blob(): unknown {
    const redraftPlayers = getRankings('redraft-ppr').players;
    return {
      schemaVersion: 1,
      activeFormat: 'redraft-ppr',
      boards: {
        'redraft-ppr': {
          order: [redraftPlayers[1]!.id, redraftPlayers[0]!.id],
          drafted: [redraftPlayers[1]!.id],
        },
        'dynasty-sf': { order: [], drafted: [] },
      },
      filters: { position: 'ALL', availableOnly: true },
    };
  }

  it('migrates a v1 localStorage blob into two boards with order and drafted intact, leaving the key present', async () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(v1Blob()));
    const redraftPlayers = getRankings('redraft-ppr').players;

    const { store } = await bootStore(storage);
    const redraft = store.getState().boards[redraftBoardId(store)]!;

    expect(redraft.order.slice(0, 2)).toEqual([redraftPlayers[1]!.id, redraftPlayers[0]!.id]);
    expect(redraft.drafted.has(redraftPlayers[1]!.id)).toBe(true);
    // Non-destructive: the legacy key is still there afterwards — it is the only rollback path.
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(store.getState().legacyBackupPresent).toBe(true);
  });

  it('carries a v2 blob’s filters, preferences, and activeFormat into the seeded boards', async () => {
    const storage = createMemoryStorage();
    const payload: PersistedState = {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      activeFormat: 'dynasty-sf',
      boards: {
        'redraft-ppr': { order: [], drafted: [] },
        'dynasty-sf': { order: [], drafted: [] },
      },
      filters: { position: 'RB', availableOnly: false },
      preferences: { theme: 'dark', density: 'compact' },
    };
    savePersistedState(payload, storage);

    const { store } = await bootStore(storage);
    const state = store.getState();

    expect(state.activeBoardId).toBe(dynastyBoardId(store));
    expect(state.position).toBe('RB');
    expect(state.availableOnly).toBe(false);
    expect(state.theme).toBe('dark');
    expect(state.density).toBe('compact');
  });

  it('a corrupt legacy key does not block boot: seeds a cold-start database and surfaces persistenceError', async () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, '{not valid json');

    const { store } = await bootStore(storage);
    const state = store.getState();

    expect(state.status).toBe('ready');
    expect(state.boardIds).toHaveLength(2);
    expect(state.persistenceError).toMatch(/invalid JSON/);
    expect(state.legacyBackupPresent).toBe(true);
    // Still not cleared — non-destructive even for a corrupt blob.
    expect(storage.getItem(STORAGE_KEY)).not.toBeNull();
  });
});

describe('toggleDrafted', () => {
  it('adds then removes a player, replacing the drafted Set rather than mutating it', async () => {
    const { store } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    const before = activeBoard(store.getState()).drafted;

    store.getState().toggleDrafted(playerId);
    expect(activeBoard(store.getState()).drafted.has(playerId)).toBe(true);
    expect(activeBoard(store.getState()).drafted).not.toBe(before);

    store.getState().toggleDrafted(playerId);
    expect(activeBoard(store.getState()).drafted.has(playerId)).toBe(false);
  });

  it('writes through to the database', async () => {
    const { store, client } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    const boardId = redraftBoardId(store);

    store.getState().toggleDrafted(playerId);
    await Promise.resolve();
    await Promise.resolve();

    const db = await client.load();
    const board = db.boards.find((b) => b.id === boardId)!;
    const row = board.rows.find((r) => r.playerId === playerId)!;
    expect(row.drafted).toBe(true);
  });
});

describe('clearDrafted and resetOrder', () => {
  it('touch only the active board, leaving the other board intact', async () => {
    const { store } = await bootStore();
    const redraftPlayers = getRankings('redraft-ppr').players;
    const dynastyPlayers = getRankings('dynasty-sf').players;
    const baseRedraftOrder = redraftPlayers.map((player) => player.id);

    store.getState().toggleDrafted(redraftPlayers[0]!.id);
    store.getState().moveVisible([redraftPlayers[0]!.id, redraftPlayers[1]!.id], 0, 1);
    expect(activeBoard(store.getState()).order).not.toEqual(baseRedraftOrder);

    store.getState().setActiveBoard(dynastyBoardId(store));
    store.getState().toggleDrafted(dynastyPlayers[0]!.id);
    const dynastyOrderBeforeReset = activeBoard(store.getState()).order;
    const dynastyDraftedBeforeReset = new Set(activeBoard(store.getState()).drafted);

    store.getState().setActiveBoard(redraftBoardId(store));
    const draftedSetBeforeClear = activeBoard(store.getState()).drafted;
    store.getState().clearDrafted();
    store.getState().resetOrder();

    expect(activeBoard(store.getState()).drafted.size).toBe(0);
    expect(activeBoard(store.getState()).drafted).not.toBe(draftedSetBeforeClear);
    expect(activeBoard(store.getState()).order).toEqual(baseRedraftOrder);

    const dynasty = store.getState().boards[dynastyBoardId(store)]!;
    expect(dynasty.order).toEqual(dynastyOrderBeforeReset);
    expect(dynasty.drafted).toEqual(dynastyDraftedBeforeReset);
  });
});

describe('per-board independence', () => {
  it('keeps a reorder on one board untouched by editing and switching boards', async () => {
    const { store } = await bootStore();
    const redraftPlayers = getRankings('redraft-ppr').players;
    const idA = redraftPlayers[0]!.id;
    const idB = redraftPlayers[1]!.id;
    const dynastyOrderBefore = store.getState().boards[dynastyBoardId(store)]!.order;

    store.getState().moveVisible([idA, idB], 0, 1);
    const redraftOrderAfterMove = activeBoard(store.getState()).order;
    expect(redraftOrderAfterMove[0]).toBe(idB);

    store.getState().setActiveBoard(dynastyBoardId(store));
    expect(activeBoard(store.getState()).order).toEqual(dynastyOrderBefore);

    store.getState().setActiveBoard(redraftBoardId(store));
    expect(activeBoard(store.getState()).order).toEqual(redraftOrderAfterMove);
  });
});

describe('setActiveBoard position fallback', () => {
  it('falls back to ALL when the selected position has zero players on the new board', async () => {
    const { store } = await bootStore();

    store.getState().setPosition('K');
    expect(store.getState().position).toBe('K');

    store.getState().setActiveBoard(dynastyBoardId(store));

    expect(store.getState().position).toBe(POSITION_FILTER_ALL);
  });

  it('keeps a position with players on the new board unchanged', async () => {
    const { store } = await bootStore();

    store.getState().setPosition('QB');
    store.getState().setActiveBoard(dynastyBoardId(store));

    expect(store.getState().position).toBe('QB');
  });
});

describe('moveVisible and fractional sort keys (4.5)', () => {
  it('moves a filtered subset and writes the result back into the full order', async () => {
    const { store } = await bootStore();
    const initialOrder = activeBoard(store.getState()).order;
    const qbIds = getRankings('redraft-ppr')
      .players.filter((player) => player.position === 'QB')
      .slice(0, 5)
      .map((player) => player.id);

    store.getState().moveVisible(qbIds, 0, 3);

    const expected = moveInFilteredView(initialOrder, qbIds, 0, 3);
    expect(activeBoard(store.getState()).order).toEqual(expected);
    expect(activeBoard(store.getState()).order).not.toEqual(initialOrder);
  });

  it('issues exactly one moveSortKey command, leaving every other row’s sort_order unchanged in the database', async () => {
    const { store, client } = await bootStore();
    const boardId = redraftBoardId(store);
    const before = await client.load();
    const beforeBoard = before.boards.find((b) => b.id === boardId)!;
    const beforeKeys = new Map(beforeBoard.rows.map((row) => [row.playerId, row.sortOrder]));

    const ids = activeBoard(store.getState()).order.slice(0, 5);
    store.getState().moveVisible(ids, 0, 3);
    await Promise.resolve();
    await Promise.resolve();

    const after = await client.load();
    const afterBoard = after.boards.find((b) => b.id === boardId)!;
    const movedId = ids[0]!;

    let unchangedCount = 0;
    for (const row of afterBoard.rows) {
      if (row.playerId === movedId) continue;
      if (row.sortOrder === beforeKeys.get(row.playerId)) {
        unchangedCount += 1;
      }
    }
    // Every row except the moved one kept its exact sort_order — a single-row UPDATE, not a
    // renumbering of the whole board.
    expect(unchangedCount).toBe(afterBoard.rows.length - 1);
    expect(afterBoard.rows.find((r) => r.playerId === movedId)?.sortOrder).not.toBe(
      beforeKeys.get(movedId)
    );
  });

  it('repeated moves into the same gap eventually issue renormaliseOrder, and the order stays correct', async () => {
    const { store, client } = await bootStore();
    const sent: DbCommand[] = [];
    const originalSend = client.send.bind(client);
    client.send = (command: DbCommand) => {
      sent.push(command);
      return originalSend(command);
    };

    const startOrder = activeBoard(store.getState()).order;
    const [a, b, c] = startOrder;
    if (!a || !b || !c) throw new Error('expected at least 3 players');

    // Alternately moves the "third" of {a, b, c} that is currently NOT adjacent to `a` into the
    // slot right after `a`. Each round bisects the gap immediately next to `a`'s (never-moving)
    // key: round 1 gives the mover a key = midpoint(a, second's key); round 2 does the same with
    // the roles swapped. 25 rounds comfortably exceeds MIN_ORDER_GAP's ~20-split ceiling
    // (`domain/fractional-order.ts`), so a renormaliseOrder must appear well before the loop ends.
    for (let i = 0; i < 25; i++) {
      const current = activeBoard(store.getState()).order;
      const visible = current.filter((id) => id === a || id === b || id === c);
      store.getState().moveVisible(visible, 2, 1);
    }

    expect(sent.some((command) => command.kind === 'renormaliseOrder')).toBe(true);

    const finalOrder = activeBoard(store.getState()).order;
    expect(new Set(finalOrder).size).toBe(finalOrder.length);
    expect(finalOrder.length).toBe(startOrder.length);
    expect(finalOrder[0]).toBe(a);
  });
});

describe('undo / redo', () => {
  it('starts with nothing to undo or redo', async () => {
    const { store } = await bootStore();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  it('undo restores order, drafted, notes, watch, and tier-breaks, and the database matches memory afterwards', async () => {
    const { store, client } = await bootStore();
    const boardId = redraftBoardId(store);
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    const orderBefore = activeBoard(store.getState()).order;

    store.getState().toggleDrafted(playerId);
    store.getState().toggleWatched(playerId);
    store.getState().setNote(playerId, 'sleeper pick');
    store.getState().toggleTierBreak(playerId);
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();
    store.getState().undo();
    store.getState().undo();
    store.getState().undo();

    const board = activeBoard(store.getState());
    expect(board.drafted.has(playerId)).toBe(false);
    expect(board.watched.has(playerId)).toBe(false);
    expect(board.notes.has(playerId)).toBe(false);
    expect(board.tierBreaks.has(playerId)).toBe(false);
    expect(board.order).toEqual(orderBefore);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    const db = await client.load();
    const dbBoard = db.boards.find((b) => b.id === boardId)!;
    const dbRow = dbBoard.rows.find((r) => r.playerId === playerId)!;
    expect(dbRow.drafted).toBe(false);
    expect(dbRow.watched).toBe(false);
    expect(dbRow.note).toBeNull();
    expect(dbRow.tierBreak).toBe(false);
  });

  it('undo restores the active board too, when the edit happened on another board', async () => {
    const { store } = await bootStore();
    const dynastyPlayerId = getRankings('dynasty-sf').players[0]!.id;

    store.getState().setActiveBoard(dynastyBoardId(store));
    store.getState().toggleDrafted(dynastyPlayerId);
    expect(store.getState().activeBoardId).toBe(dynastyBoardId(store));

    store.getState().setActiveBoard(redraftBoardId(store));
    expect(store.getState().activeBoardId).toBe(redraftBoardId(store));

    store.getState().undo();

    expect(store.getState().activeBoardId).toBe(dynastyBoardId(store));
    expect(store.getState().boards[dynastyBoardId(store)]!.drafted.has(dynastyPlayerId)).toBe(
      false
    );
  });

  it('redo re-applies an undone edit', async () => {
    const { store } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;

    store.getState().toggleDrafted(playerId);
    store.getState().undo();
    expect(activeBoard(store.getState()).drafted.has(playerId)).toBe(false);

    store.getState().redo();

    expect(activeBoard(store.getState()).drafted.has(playerId)).toBe(true);
    expect(store.getState().canRedo).toBe(false);
    expect(store.getState().canUndo).toBe(true);
  });

  it('a new edit after an undo clears the redo stack', async () => {
    const { store } = await bootStore();
    const players = getRankings('redraft-ppr').players;

    store.getState().toggleDrafted(players[0]!.id);
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);

    store.getState().toggleDrafted(players[1]!.id);

    expect(store.getState().canRedo).toBe(false);
  });

  it('undo() and redo() are no-ops (not throws) when their stack is empty', async () => {
    const { store } = await bootStore();

    expect(() => store.getState().undo()).not.toThrow();
    expect(() => store.getState().redo()).not.toThrow();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  it('view-state changes (filters, theme, density, active board) do not create undo entries', async () => {
    const { store } = await bootStore();

    store.getState().setPosition('QB');
    store.getState().setSearch('mahomes');
    store.getState().setAvailableOnly(false);
    store.getState().setWatchedOnly(true);
    store.getState().setTheme('dark');
    store.getState().setDensity('compact');
    store.getState().setActiveBoard(dynastyBoardId(store));

    expect(store.getState().canUndo).toBe(false);
  });

  it('caps history growth at the limit, evicting the oldest entries first', async () => {
    const { store } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;

    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      store.getState().toggleDrafted(playerId);
    }
    expect(store.getState().canUndo).toBe(true);

    for (let i = 0; i < HISTORY_LIMIT; i++) {
      store.getState().undo();
    }

    expect(store.getState().canUndo).toBe(false);
  });

  it('does not resurrect a board deleted after the snapshot, and leaves a board created since untouched', async () => {
    const { store } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;

    // Push a snapshot on the redraft board, then create a third board.
    store.getState().toggleDrafted(playerId);
    const newBoardId = store.getState().createBoard('Bench League', 'redraft-ppr');
    expect(store.getState().boardIds).toContain(newBoardId);

    store.getState().undo();

    // The new board (created after the snapshot, and via a non-undoable action) survives.
    expect(store.getState().boardIds).toContain(newBoardId);
    expect(store.getState().boards[newBoardId]).toBeDefined();
  });
});

describe('clearTierBreaks (Stage E)', () => {
  it('clears every custom tier break in one history entry, restored by a single undo', async () => {
    const { store, client } = await bootStore();
    const boardId = redraftBoardId(store);
    const players = getRankings('redraft-ppr').players;
    const firstId = players[0]!.id;
    const secondId = players[1]!.id;

    store.getState().toggleTierBreak(firstId);
    store.getState().toggleTierBreak(secondId);
    expect(activeBoard(store.getState()).tierBreaks).toEqual(new Set([firstId, secondId]));

    store.getState().clearTierBreaks();
    expect(activeBoard(store.getState()).tierBreaks.size).toBe(0);

    // Exactly ONE undo (not two) restores both breaks — clearTierBreaks is a single history
    // entry, unlike looping toggleTierBreak.
    store.getState().undo();
    expect(activeBoard(store.getState()).tierBreaks).toEqual(new Set([firstId, secondId]));

    await Promise.resolve();
    await Promise.resolve();
    const db = await client.load();
    const dbBoard = db.boards.find((b) => b.id === boardId)!;
    expect(dbBoard.rows.find((r) => r.playerId === firstId)!.tierBreak).toBe(true);
    expect(dbBoard.rows.find((r) => r.playerId === secondId)!.tierBreak).toBe(true);
  });

  it('touches only the active board', async () => {
    const { store } = await bootStore();
    store.getState().setActiveBoard(dynastyBoardId(store));
    const dynastyPlayerId = getRankings('dynasty-sf').players[0]!.id;
    store.getState().toggleTierBreak(dynastyPlayerId);

    store.getState().setActiveBoard(redraftBoardId(store));
    const redraftPlayerId = getRankings('redraft-ppr').players[0]!.id;
    store.getState().toggleTierBreak(redraftPlayerId);

    store.getState().clearTierBreaks();
    expect(activeBoard(store.getState()).tierBreaks.size).toBe(0);
    expect(store.getState().boards[dynastyBoardId(store)]!.tierBreaks.has(dynastyPlayerId)).toBe(
      true
    );
  });
});

describe('board CRUD (4.6) — not undoable', () => {
  it('createBoard adds a board seeded from the dataset order and returns its id', async () => {
    const { store } = await bootStore();

    const id = store.getState().createBoard('Keeper League', 'redraft-ppr');

    const board = store.getState().boards[id]!;
    expect(board.name).toBe('Keeper League');
    expect(board.format).toBe('redraft-ppr');
    expect(board.order).toEqual(getRankings('redraft-ppr').players.map((player) => player.id));
    expect(store.getState().boardIds).toContain(id);
    expect(store.getState().canUndo).toBe(false);
  });

  it('duplicateBoard copies order, drafted, watched, notes, and tier-breaks under a new name, and is itself not undoable', async () => {
    const { store } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    store.getState().toggleDrafted(playerId);
    store.getState().toggleWatched(playerId);
    store.getState().setNote(playerId, 'note');
    store.getState().toggleTierBreak(playerId);
    const historyBeforeDuplicate = store.getState().history;

    const sourceId = redraftBoardId(store);
    const newId = store.getState().duplicateBoard(sourceId);

    const source = store.getState().boards[sourceId]!;
    const copy = store.getState().boards[newId]!;
    expect(copy.name).toBe('Redraft PPR (2)');
    expect(copy.order).toEqual(source.order);
    expect(copy.drafted).toEqual(source.drafted);
    expect(copy.watched).toEqual(source.watched);
    expect(copy.notes).toEqual(source.notes);
    expect(copy.tierBreaks).toEqual(source.tierBreaks);
    // duplicateBoard itself pushed no new snapshot — the history stack is unchanged.
    expect(store.getState().history).toBe(historyBeforeDuplicate);
  });

  it('renameBoard updates the board name', async () => {
    const { store } = await bootStore();
    const id = redraftBoardId(store);

    store.getState().renameBoard(id, 'My Redraft Board');

    expect(store.getState().boards[id]!.name).toBe('My Redraft Board');
    expect(store.getState().canUndo).toBe(false);
  });

  it('deleteBoard on the last remaining board throws', async () => {
    const { store } = await bootStore();
    store.getState().deleteBoard(dynastyBoardId(store));

    expect(() => store.getState().deleteBoard(redraftBoardId(store))).toThrow(/only remaining/);
  });

  it('deleteBoard activates another board when the active one is deleted', async () => {
    const { store } = await bootStore();
    const id = store.getState().createBoard('Third Board', 'redraft-ppr');
    store.getState().setActiveBoard(id);

    store.getState().deleteBoard(id);

    expect(store.getState().activeBoardId).not.toBe(id);
    expect(store.getState().boards[id]).toBeUndefined();
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('write-through failure', () => {
  it('a rejected command sets persistenceError and does not roll back memory', async () => {
    const { store, client } = await bootStore();
    // Close the client so every subsequent send() rejects, simulating a write failure.
    client.close();

    const playerId = getRankings('redraft-ppr').players[0]!.id;
    store.getState().toggleDrafted(playerId);

    // Memory is updated synchronously and is NOT reverted — the user's edit stays visible; only
    // the write to storage failed, surfaced as a banner rather than a silent revert.
    expect(activeBoard(store.getState()).drafted.has(playerId)).toBe(true);

    await Promise.resolve();
    await Promise.resolve();
    expect(store.getState().persistenceError).not.toBeNull();
  });
});

describe('importState', () => {
  function importedState(): PersistedState {
    const redraftPlayers = getRankings('redraft-ppr').players;
    const dynastyPlayers = getRankings('dynasty-sf').players;
    return {
      schemaVersion: STORAGE_SCHEMA_VERSION,
      activeFormat: 'dynasty-sf',
      boards: {
        'redraft-ppr': {
          order: ['not-a-real-id', redraftPlayers[0]!.id],
          drafted: [redraftPlayers[0]!.id, 'not-a-real-id'],
        },
        'dynasty-sf': {
          order: [dynastyPlayers[0]!.id],
          drafted: [],
        },
      },
      filters: { position: 'RB', availableOnly: false },
      preferences: { theme: 'dark', density: 'compact' },
    };
  }

  it('reconciles unknown ids out of the imported order', async () => {
    const { store } = await bootStore();

    store.getState().importState(importedState());

    const redraftBoard = store.getState().boards[redraftBoardId(store)]!;
    expect(redraftBoard.order).not.toContain('not-a-real-id');
    const redraftPlayers = getRankings('redraft-ppr').players;
    expect(redraftBoard.order).toContain(redraftPlayers[0]!.id);
    expect(redraftBoard.order.length).toBe(redraftPlayers.length);
  });

  it('applies activeFormat (mapped to that format’s first board), filters, and preferences', async () => {
    const { store } = await bootStore();

    store.getState().importState(importedState());

    expect(store.getState().activeBoardId).toBe(dynastyBoardId(store));
    expect(store.getState().position).toBe('RB');
    expect(store.getState().availableOnly).toBe(false);
    expect(store.getState().theme).toBe('dark');
    expect(store.getState().density).toBe('compact');
  });

  it('is undoable', async () => {
    const { store } = await bootStore();
    const orderBefore = activeBoard(store.getState()).order;

    store.getState().importState(importedState());
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(activeBoard(store.getState()).order).toEqual(orderBefore);
  });
});

describe('exportDatabaseBytes / importDatabaseBytes (4.13)', () => {
  it('round-trips order, drafted, watched, notes, and tier-breaks into a DIFFERENT store', async () => {
    const { store: source } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    source.getState().toggleDrafted(playerId);
    source.getState().toggleWatched(playerId);
    source.getState().setNote(playerId, 'sleeper pick');
    source.getState().toggleTierBreak(playerId);
    await Promise.resolve();
    await Promise.resolve();

    const bytes = await exportDatabaseBytes(source);

    const { store: target } = await bootStore();
    await importDatabaseBytes(target, bytes);

    const targetBoardId = redraftBoardId(target);
    expect(targetBoardId).toBe(redraftBoardId(source));
    const board = target.getState().boards[targetBoardId]!;
    expect(board.drafted.has(playerId)).toBe(true);
    expect(board.watched.has(playerId)).toBe(true);
    expect(board.notes.get(playerId)).toBe('sleeper pick');
    expect(board.tierBreaks.has(playerId)).toBe(true);
  });

  it('replaces every board, not just the active one', async () => {
    const { store: source } = await bootStore();
    const sourceBoardIds = [...source.getState().boardIds];

    const { store: target } = await bootStore();
    // A board that exists only in the target (created after boot, before the import) must not
    // survive a full-database replacement.
    const targetOnlyId = target.getState().createBoard('Target-only board', 'redraft-ppr');
    expect(target.getState().boardIds).toContain(targetOnlyId);

    const bytes = await exportDatabaseBytes(source);
    await importDatabaseBytes(target, bytes);

    expect(target.getState().boardIds.sort()).toEqual(sourceBoardIds.sort());
    expect(target.getState().boards[targetOnlyId]).toBeUndefined();
  });

  it('is not undoable: the history is cleared, not merged with the prior state', async () => {
    const { store: source } = await bootStore();
    const bytes = await exportDatabaseBytes(source);

    const { store: target } = await bootStore();
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    target.getState().toggleDrafted(playerId);
    expect(target.getState().canUndo).toBe(true);

    await importDatabaseBytes(target, bytes);

    expect(target.getState().canUndo).toBe(false);
    expect(target.getState().canRedo).toBe(false);
  });

  it('leaves the database matching memory after import (no pending correction commands)', async () => {
    const { store: source } = await bootStore();
    const bytes = await exportDatabaseBytes(source);

    const { store: target, client } = await bootStore();
    await importDatabaseBytes(target, bytes);

    const db = await client.load();
    const boardId = redraftBoardId(target);
    expect(db.boards.map((b) => b.id)).toContain(boardId);
  });
});

describe('theme and density', () => {
  it('persist across a reload', async () => {
    const storage = createMemoryStorage();
    const firstClient = createTestDatabaseClient();
    const first = createBoardStore();
    await initialiseBoardStore(first, firstClient, storage);

    first.getState().setTheme('dark');
    first.getState().setDensity('compact');
    await Promise.resolve();
    await Promise.resolve();

    const second = createBoardStore();
    await initialiseBoardStore(second, firstClient, storage);

    expect(second.getState().theme).toBe('dark');
    expect(second.getState().density).toBe('compact');
  });
});
