/**
 * Shared test helper: re-initialises the `useBoardStore` singleton against a fresh in-process
 * SQLite `DatabaseClient` (`state/db/client.test-support.ts`) and a fresh in-memory `Storage`
 * before each test. Every component test that used to hand-drive the old singleton back to known
 * defaults via `setFormat`/`clearDrafted`/`resetOrder` now just re-boots it — `initialiseBoardStore`
 * fully replaces boards/filters/preferences/history, so a fresh two-board cold start is
 * guaranteed rather than assembled by a sequence of actions that could itself have a bug.
 */
import { act } from '@testing-library/react';
import type { Format } from '@/domain';
import { initialiseBoardStore, useBoardStore } from '@/state';
import { createTestDatabaseClient } from '@/state/db/client.test-support';

export function createMemoryStorage(): Storage {
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

/** Re-initialises the app singleton store from a fresh cold-start database. Call from
 * `beforeEach` in any test that renders a component reading `useBoardStore`. */
export async function resetBoardStore(): Promise<void> {
  await act(async () => {
    await initialiseBoardStore(useBoardStore, createTestDatabaseClient(), createMemoryStorage());
  });
}

/** The seeded board id for `format` — after `resetBoardStore()`, this is one of the two
 * always-present "Redraft PPR" / "Dynasty Superflex" boards. Throws if none matches. */
export function boardIdForFormat(format: Format): string {
  const state = useBoardStore.getState();
  const id = state.boardIds.find((boardId) => state.boards[boardId]?.format === format);
  if (!id) {
    throw new Error(`boardIdForFormat: no board with format "${format}" in the current store.`);
  }
  return id;
}
