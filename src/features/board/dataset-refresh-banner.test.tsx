import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createBoardMeta } from '@/domain';
import type { BoardPlayerRow } from '@/state/db';
import { getRankings, initialiseBoardStore, useBoardStore } from '@/state';
import { createTestDatabaseClient } from '@/state/db/client.test-support';
import { DatasetRefreshBanner } from './dataset-refresh-banner';
import { createMemoryStorage, resetBoardStore } from '../../../tests/test-store';

/** Seeds a WARM database directly (bypassing the store's own cold-start seeding) with a board
 * whose rows reference a subset of the current dataset plus one id the dataset no longer has —
 * simulating rows persisted from an earlier session against an OLDER dataset, so
 * `initialiseBoardStore`'s reconciliation genuinely finds `added`/`removed` players — then
 * initialises the app's `useBoardStore` singleton from it, exactly as `main.tsx` would. */
async function bootWarmWithStaleBoard(): Promise<void> {
  const client = createTestDatabaseClient();
  await client.open();

  const players = getRankings('redraft-ppr').players;
  const keptIds = players.slice(0, 5).map((player) => player.id);
  const rows: BoardPlayerRow[] = [
    ...keptIds.map((playerId, index) => ({
      playerId,
      sortOrder: index,
      drafted: false,
      watched: false,
      tierBreak: false,
      note: null,
    })),
    {
      playerId: 'retired-player-not-in-dataset',
      sortOrder: keptIds.length,
      drafted: false,
      watched: false,
      tierBreak: false,
      note: null,
    },
  ];
  await client.sendAll([
    {
      kind: 'createBoard',
      board: createBoardMeta('stale-board', 'Redraft PPR', 'redraft-ppr', new Date().toISOString()),
      rows,
    },
  ]);

  await act(async () => {
    await initialiseBoardStore(useBoardStore, client, createMemoryStorage());
  });
}

describe('DatasetRefreshBanner', () => {
  it('renders nothing on a cold start (every board is freshly seeded, so report.changed is always false)', async () => {
    await resetBoardStore();
    render(<DatasetRefreshBanner />);

    expect(useBoardStore.getState().datasetReports[useBoardStore.getState().activeBoardId]).toEqual(
      { added: [], removed: [], duplicates: [], changed: false }
    );
    expect(screen.queryByText(/changed since you last opened it/)).not.toBeInTheDocument();
  });

  it('names what changed on a warm boot whose persisted rows no longer match the dataset', async () => {
    await bootWarmWithStaleBoard();

    render(<DatasetRefreshBanner />);

    const banner = screen.getByText(/changed since you last opened it/);
    expect(banner).toHaveTextContent('players added');
    expect(banner).toHaveTextContent('1 player removed');
    expect(banner).toHaveTextContent('notes, watchlist flags, and custom tier breaks');
  });

  it('dismisses for the session without reappearing', async () => {
    const user = userEvent.setup();
    await bootWarmWithStaleBoard();
    render(<DatasetRefreshBanner />);

    expect(screen.getByText(/changed since you last opened it/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/changed since you last opened it/)).not.toBeInTheDocument();
  });
});
