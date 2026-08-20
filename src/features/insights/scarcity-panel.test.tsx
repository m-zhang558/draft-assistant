import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getRankings, useBoardStore } from '@/state';
import { ScarcityPanel } from './scarcity-panel';
import { boardIdForFormat, resetBoardStore } from '../../../tests/test-store';

describe('ScarcityPanel', () => {
  beforeEach(async () => {
    await resetBoardStore();
  });

  it('renders one entry per position, ordered like POSITIONS, with remaining counts', () => {
    render(<ScarcityPanel />);

    expect(screen.getByText('Positional scarcity')).toBeInTheDocument();
    // QB is ranked in redraft-ppr (49 players, see PROJECT.md §3) and nobody is drafted yet.
    expect(screen.getByRole('button', { name: /^QB/ })).toHaveTextContent('49 left');
  });

  it('renders a zero-player position as "not ranked", not "0 left" (dynasty-sf has no K/DST)', () => {
    act(() => {
      useBoardStore.getState().setActiveBoard(boardIdForFormat('dynasty-sf'));
    });
    render(<ScarcityPanel />);

    // Both K and DST are unranked in dynasty-sf (PROJECT.md §3).
    expect(screen.getAllByText('Not ranked in this format')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /^K/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^DST/ })).not.toBeInTheDocument();
  });

  it('shows "no tier data" for a ranked-but-untiered position (redraft-ppr K/DST)', () => {
    render(<ScarcityPanel />);

    expect(screen.getByRole('button', { name: /^K/ })).toHaveTextContent('no tier data');
  });

  it('clicking a ranked position filters the board to it', async () => {
    const user = userEvent.setup();
    render(<ScarcityPanel />);

    await user.click(screen.getByRole('button', { name: /^RB/ }));

    expect(useBoardStore.getState().position).toBe('RB');
  });

  it('reflects drafted players by lowering the remaining count', () => {
    const playerId = getRankings('redraft-ppr').players.find((p) => p.position === 'RB')!.id;
    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    render(<ScarcityPanel />);

    expect(screen.getByRole('button', { name: /^RB/ })).toHaveTextContent('103 left');
  });
});
