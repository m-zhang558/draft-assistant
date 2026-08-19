import { HISTORY_LIMIT, POSITION_FILTER_ALL, moveInFilteredView } from '@/domain';
import { createBoardStore } from './board-store';
import { getRankings } from './rankings';
import { DEFAULT_PREFERENCES, STORAGE_KEY, type PersistedState } from './persistence';

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

describe('createBoardStore cold start', () => {
  it('has the documented defaults, with order equal to baseRank order in both formats', () => {
    const store = createBoardStore(createMemoryStorage());
    const state = store.getState();

    expect(state.activeFormat).toBe('redraft-ppr');
    expect(state.position).toBe(POSITION_FILTER_ALL);
    expect(state.search).toBe('');
    expect(state.availableOnly).toBe(true);

    expect(state.boards['redraft-ppr'].order).toEqual(
      getRankings('redraft-ppr').players.map((player) => player.id)
    );
    expect(state.boards['dynasty-sf'].order).toEqual(
      getRankings('dynasty-sf').players.map((player) => player.id)
    );
    expect(state.boards['redraft-ppr'].drafted.size).toBe(0);
    expect(state.boards['dynasty-sf'].drafted.size).toBe(0);
  });
});

describe('toggleDrafted', () => {
  it('adds then removes a player, and writes through to storage on every change', () => {
    const storage = createMemoryStorage();
    const store = createBoardStore(storage);
    const playerId = getRankings('redraft-ppr').players[0]!.id;

    store.getState().toggleDrafted(playerId);
    expect(store.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
    const savedAfterAdd = JSON.parse(storage.getItem(STORAGE_KEY)!) as {
      boards: { 'redraft-ppr': { drafted: string[] } };
    };
    expect(savedAfterAdd.boards['redraft-ppr'].drafted).toContain(playerId);

    store.getState().toggleDrafted(playerId);
    expect(store.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(false);
    const savedAfterRemove = JSON.parse(storage.getItem(STORAGE_KEY)!) as {
      boards: { 'redraft-ppr': { drafted: string[] } };
    };
    expect(savedAfterRemove.boards['redraft-ppr'].drafted).not.toContain(playerId);
  });

  it('replaces the drafted Set rather than mutating it in place', () => {
    const store = createBoardStore(createMemoryStorage());
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    const before = store.getState().boards['redraft-ppr'].drafted;

    store.getState().toggleDrafted(playerId);

    expect(store.getState().boards['redraft-ppr'].drafted).not.toBe(before);
  });
});

describe('clearDrafted and resetOrder', () => {
  it('touch only the active format, leaving the other format intact', () => {
    const store = createBoardStore(createMemoryStorage());
    const redraftPlayers = getRankings('redraft-ppr').players;
    const dynastyPlayers = getRankings('dynasty-sf').players;
    const baseRedraftOrder = redraftPlayers.map((player) => player.id);

    store.getState().toggleDrafted(redraftPlayers[0]!.id);
    store.getState().moveVisible([redraftPlayers[0]!.id, redraftPlayers[1]!.id], 0, 1);
    expect(store.getState().boards['redraft-ppr'].order).not.toEqual(baseRedraftOrder);

    store.getState().setFormat('dynasty-sf');
    store.getState().toggleDrafted(dynastyPlayers[0]!.id);
    const dynastyOrderBeforeReset = store.getState().boards['dynasty-sf'].order;
    const dynastyDraftedBeforeReset = new Set(store.getState().boards['dynasty-sf'].drafted);

    store.getState().setFormat('redraft-ppr');
    const draftedSetBeforeClear = store.getState().boards['redraft-ppr'].drafted;
    store.getState().clearDrafted();
    store.getState().resetOrder();

    expect(store.getState().boards['redraft-ppr'].drafted.size).toBe(0);
    expect(store.getState().boards['redraft-ppr'].drafted).not.toBe(draftedSetBeforeClear);
    expect(store.getState().boards['redraft-ppr'].order).toEqual(baseRedraftOrder);

    expect(store.getState().boards['dynasty-sf'].order).toEqual(dynastyOrderBeforeReset);
    expect(store.getState().boards['dynasty-sf'].drafted).toEqual(dynastyDraftedBeforeReset);
  });
});

describe('refresh (persisted state restore)', () => {
  it('restores order, drafted, activeFormat and filters from a previous store’s writes', () => {
    const storage = createMemoryStorage();
    const first = createBoardStore(storage);
    const dynastyPlayers = getRankings('dynasty-sf').players;
    const idA = dynastyPlayers[0]!.id;
    const idB = dynastyPlayers[1]!.id;

    first.getState().setFormat('dynasty-sf');
    first.getState().toggleDrafted(idA);
    first.getState().setPosition('QB');
    first.getState().setAvailableOnly(false);
    first.getState().moveVisible([idA, idB], 0, 1);

    const expectedOrder = first.getState().boards['dynasty-sf'].order;

    const second = createBoardStore(storage);
    const state = second.getState();

    expect(state.activeFormat).toBe('dynasty-sf');
    expect(state.position).toBe('QB');
    expect(state.availableOnly).toBe(false);
    expect(state.boards['dynasty-sf'].order).toEqual(expectedOrder);
    expect(state.boards['dynasty-sf'].drafted.has(idA)).toBe(true);
  });
});

describe('per-format independence', () => {
  it('keeps a reorder in one format untouched by editing and switching formats', () => {
    const store = createBoardStore(createMemoryStorage());
    const redraftPlayers = getRankings('redraft-ppr').players;
    const idA = redraftPlayers[0]!.id;
    const idB = redraftPlayers[1]!.id;
    const dynastyOrderBefore = store.getState().boards['dynasty-sf'].order;

    store.getState().moveVisible([idA, idB], 0, 1);
    const redraftOrderAfterMove = store.getState().boards['redraft-ppr'].order;
    expect(redraftOrderAfterMove[0]).toBe(idB);

    store.getState().setFormat('dynasty-sf');
    expect(store.getState().boards['dynasty-sf'].order).toEqual(dynastyOrderBefore);

    store.getState().setFormat('redraft-ppr');
    expect(store.getState().boards['redraft-ppr'].order).toEqual(redraftOrderAfterMove);
  });
});

describe('setFormat position fallback', () => {
  it('falls back to ALL when the selected position has zero players in the new format', () => {
    const store = createBoardStore(createMemoryStorage());

    store.getState().setPosition('K');
    expect(store.getState().position).toBe('K');

    store.getState().setFormat('dynasty-sf');

    expect(store.getState().position).toBe(POSITION_FILTER_ALL);
  });

  it('keeps a position with players in the new format unchanged', () => {
    const store = createBoardStore(createMemoryStorage());

    store.getState().setPosition('QB');
    store.getState().setFormat('dynasty-sf');

    expect(store.getState().position).toBe('QB');
  });
});

describe('moveVisible', () => {
  it('moves a filtered subset and writes the result back into the full order', () => {
    const storage = createMemoryStorage();
    const store = createBoardStore(storage);
    const initialOrder = store.getState().boards['redraft-ppr'].order;
    const qbIds = getRankings('redraft-ppr')
      .players.filter((player) => player.position === 'QB')
      .slice(0, 5)
      .map((player) => player.id);

    store.getState().moveVisible(qbIds, 0, 3);

    const expected = moveInFilteredView(initialOrder, qbIds, 0, 3);
    expect(store.getState().boards['redraft-ppr'].order).toEqual(expected);
    expect(store.getState().boards['redraft-ppr'].order).not.toEqual(initialOrder);
  });
});

describe('undo / redo', () => {
  it('starts with nothing to undo or redo', () => {
    const store = createBoardStore(createMemoryStorage());
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  it('undo restores order and drafted from before the edit', () => {
    const store = createBoardStore(createMemoryStorage());
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    const orderBefore = store.getState().boards['redraft-ppr'].order;

    store.getState().toggleDrafted(playerId);
    expect(store.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(false);
    expect(store.getState().boards['redraft-ppr'].order).toEqual(orderBefore);
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);
  });

  it('undo restores the active format too, when the edit happened in the other format', () => {
    const store = createBoardStore(createMemoryStorage());
    const dynastyPlayerId = getRankings('dynasty-sf').players[0]!.id;

    store.getState().setFormat('dynasty-sf');
    store.getState().toggleDrafted(dynastyPlayerId);
    expect(store.getState().activeFormat).toBe('dynasty-sf');

    store.getState().setFormat('redraft-ppr');
    expect(store.getState().activeFormat).toBe('redraft-ppr');

    store.getState().undo();

    // The undo restores the format the edit happened in, so the change is always visible.
    expect(store.getState().activeFormat).toBe('dynasty-sf');
    expect(store.getState().boards['dynasty-sf'].drafted.has(dynastyPlayerId)).toBe(false);
  });

  it('redo re-applies an undone edit', () => {
    const store = createBoardStore(createMemoryStorage());
    const playerId = getRankings('redraft-ppr').players[0]!.id;

    store.getState().toggleDrafted(playerId);
    store.getState().undo();
    expect(store.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(false);

    store.getState().redo();

    expect(store.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
    expect(store.getState().canRedo).toBe(false);
    expect(store.getState().canUndo).toBe(true);
  });

  it('a new edit after an undo clears the redo stack', () => {
    const store = createBoardStore(createMemoryStorage());
    const players = getRankings('redraft-ppr').players;

    store.getState().toggleDrafted(players[0]!.id);
    store.getState().undo();
    expect(store.getState().canRedo).toBe(true);

    store.getState().toggleDrafted(players[1]!.id);

    expect(store.getState().canRedo).toBe(false);
  });

  it('undo() and redo() are no-ops (not throws) when their stack is empty', () => {
    const store = createBoardStore(createMemoryStorage());

    expect(() => store.getState().undo()).not.toThrow();
    expect(() => store.getState().redo()).not.toThrow();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(false);
  });

  it('view-state changes (filters, theme, density) do not create undo entries', () => {
    const store = createBoardStore(createMemoryStorage());

    store.getState().setPosition('QB');
    store.getState().setSearch('mahomes');
    store.getState().setAvailableOnly(false);
    store.getState().setTheme('dark');
    store.getState().setDensity('compact');

    expect(store.getState().canUndo).toBe(false);
  });

  it('caps history growth at the limit, evicting the oldest entries first', () => {
    const store = createBoardStore(createMemoryStorage());
    const playerId = getRankings('redraft-ppr').players[0]!.id;

    for (let i = 0; i < HISTORY_LIMIT + 5; i++) {
      store.getState().toggleDrafted(playerId);
    }
    expect(store.getState().canUndo).toBe(true);

    for (let i = 0; i < HISTORY_LIMIT; i++) {
      store.getState().undo();
    }

    // Exactly HISTORY_LIMIT snapshots survive — the 5 oldest edits were evicted, so undoing
    // HISTORY_LIMIT times exhausts the stack even though HISTORY_LIMIT + 5 edits were made.
    expect(store.getState().canUndo).toBe(false);
  });
});

describe('importState', () => {
  function importedState(): PersistedState {
    const redraftPlayers = getRankings('redraft-ppr').players;
    const dynastyPlayers = getRankings('dynasty-sf').players;
    return {
      schemaVersion: 2,
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

  it('reconciles unknown ids out of the imported order (order is made consistent with the dataset)', () => {
    const store = createBoardStore(createMemoryStorage());

    store.getState().importState(importedState());

    const redraftBoard = store.getState().boards['redraft-ppr'];
    expect(redraftBoard.order).not.toContain('not-a-real-id');
    const redraftPlayers = getRankings('redraft-ppr').players;
    expect(redraftBoard.order).toContain(redraftPlayers[0]!.id);
    expect(redraftBoard.order.length).toBe(redraftPlayers.length);
  });

  it('applies activeFormat, filters, and preferences from the imported blob', () => {
    const store = createBoardStore(createMemoryStorage());

    store.getState().importState(importedState());

    expect(store.getState().activeFormat).toBe('dynasty-sf');
    expect(store.getState().position).toBe('RB');
    expect(store.getState().availableOnly).toBe(false);
    expect(store.getState().theme).toBe('dark');
    expect(store.getState().density).toBe('compact');
  });

  it('is undoable: undo restores the pre-import boards and active format', () => {
    // The undo snapshot is { activeFormat, boards } only (see file header of board-store.ts) —
    // filters/preferences are view state and are not part of what undo restores, even though
    // importState itself is an undoable action.
    const store = createBoardStore(createMemoryStorage());
    const orderBefore = store.getState().boards['redraft-ppr'].order;
    const formatBefore = store.getState().activeFormat;

    store.getState().importState(importedState());
    expect(store.getState().canUndo).toBe(true);

    store.getState().undo();

    expect(store.getState().activeFormat).toBe(formatBefore);
    expect(store.getState().boards['redraft-ppr'].order).toEqual(orderBefore);
  });
});

describe('theme and density', () => {
  it('default to the documented values on cold start', () => {
    const store = createBoardStore(createMemoryStorage());

    expect(store.getState().theme).toBe(DEFAULT_PREFERENCES.theme);
    expect(store.getState().density).toBe(DEFAULT_PREFERENCES.density);
  });

  it('persist across a reload', () => {
    const storage = createMemoryStorage();
    const first = createBoardStore(storage);

    first.getState().setTheme('dark');
    first.getState().setDensity('compact');

    const second = createBoardStore(storage);

    expect(second.getState().theme).toBe('dark');
    expect(second.getState().density).toBe('compact');
  });

  it('a theme change alone triggers a persisted write', () => {
    const storage = createMemoryStorage();
    const store = createBoardStore(storage);

    store.getState().setTheme('dark');

    const saved = JSON.parse(storage.getItem(STORAGE_KEY)!) as {
      preferences: { theme: string };
    };
    expect(saved.preferences.theme).toBe('dark');
  });
});
