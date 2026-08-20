import { act, render, screen } from '@testing-library/react';
import { getRankings, useBoardStore } from '@/state';
import { ByeWeekPanel } from './bye-week-panel';
import { resetBoardStore } from '../../../tests/test-store';

describe('ByeWeekPanel', () => {
  beforeEach(async () => {
    await resetBoardStore();
  });

  it('shows an honest empty state when nothing is drafted, not an empty list', () => {
    render(<ByeWeekPanel />);

    expect(screen.getByText('Draft a player to see their bye week here.')).toBeInTheDocument();
    expect(screen.queryByText(/Week/)).not.toBeInTheDocument();
  });

  it('groups drafted players by bye week and flags a colliding position', () => {
    const players = getRankings('redraft-ppr').players;
    const rbsSharingAWeek = new Map<number, string[]>();
    for (const player of players) {
      if (player.position !== 'RB' || player.byeWeek === undefined) continue;
      const ids = rbsSharingAWeek.get(player.byeWeek) ?? [];
      ids.push(player.id);
      rbsSharingAWeek.set(player.byeWeek, ids);
    }
    const [week, ids] = [...rbsSharingAWeek.entries()].find(([, ids]) => ids.length >= 2)!;

    act(() => {
      for (const id of ids.slice(0, 2)) {
        useBoardStore.getState().toggleDrafted(id);
      }
    });

    render(<ByeWeekPanel />);

    expect(screen.getByText(`Week ${week}`)).toBeInTheDocument();
    expect(screen.getByText('RB stacked')).toBeInTheDocument();
  });

  it('counts drafted players without a bye week instead of hiding them', () => {
    // Optional fields are omitted rather than null (PROJECT.md §5) — free agents (no team) are
    // one real case with no byeWeek in the dataset.
    const noByeWeek = getRankings('redraft-ppr').players.find(
      (player) => player.byeWeek === undefined
    )!;

    act(() => {
      useBoardStore.getState().toggleDrafted(noByeWeek.id);
    });

    render(<ByeWeekPanel />);

    expect(
      screen.getByText('No bye-week collisions among your drafted players yet.')
    ).toBeInTheDocument();
    expect(screen.getByText('1 drafted player with no bye-week data.')).toBeInTheDocument();
  });
});
