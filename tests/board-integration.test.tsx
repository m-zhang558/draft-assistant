import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from '@/app';
import { useBoardStore } from '@/state';

/**
 * End-to-end coverage of Phase 2: format switch, position tabs, search, availability,
 * reorder, and the two confirmed reset actions, wired together through the real `App`.
 *
 * The board store is a module-level singleton backed by real `window.localStorage`
 * (contract §5) that hydrates once at module load, so `localStorage.clear()` alone does
 * not reset in-memory state between tests in this file — each test drives the store back
 * to known defaults for BOTH formats first.
 */
function resetStore() {
  act(() => {
    useBoardStore.getState().setFormat('dynasty-sf');
    useBoardStore.getState().clearDrafted();
    useBoardStore.getState().resetOrder();
    useBoardStore.getState().setFormat('redraft-ppr');
    useBoardStore.getState().clearDrafted();
    useBoardStore.getState().resetOrder();
    useBoardStore.getState().setPosition('ALL');
    useBoardStore.getState().setSearch('');
    useBoardStore.getState().setAvailableOnly(true);
  });
}

describe('board integration', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
  });

  it('crosses a player off, hides them under Available only, and restores them under Show all', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' }));
    expect(screen.queryByText('Jahmyr Gibbs')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Available only'));
    expect(screen.getByText('Jahmyr Gibbs')).toHaveClass('line-through');

    await user.click(screen.getByLabelText('Available only'));
    expect(screen.queryByText('Jahmyr Gibbs')).not.toBeInTheDocument();
  });

  it('filters the board by position', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('radio', { name: 'RB' }));

    const list = screen.getByRole('list', { name: 'Ranked players' });
    expect(within(list).getByText('Bijan Robinson')).toBeInTheDocument();
    expect(within(list).queryByText("Ja'Marr Chase")).not.toBeInTheDocument();
  });

  it('disables the K and DST tabs under Dynasty Superflex, which ranks neither', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('radio', { name: 'Dynasty Superflex' }));

    expect(screen.getByRole('radio', { name: 'K' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'DST' })).toBeDisabled();
  });

  it('narrows the board by search, matching both player name and team', async () => {
    const user = userEvent.setup();
    render(<App />);
    const searchBox = screen.getByLabelText('Search players by name or team');

    await user.type(searchBox, 'Mahomes');
    let list = screen.getByRole('list', { name: 'Ranked players' });
    expect(within(list).getByText('Patrick Mahomes')).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);

    await user.clear(searchBox);
    await user.type(searchBox, 'KC');
    list = screen.getByRole('list', { name: 'Ranked players' });
    expect(within(list).getByText('Patrick Mahomes')).toBeInTheDocument();
    expect(within(list).getByText('Travis Kelce')).toBeInTheDocument();
    expect(within(list).queryByText('Jahmyr Gibbs')).not.toBeInTheDocument();
  });

  it('resets to expert rankings after two confirmed clicks, undoing a reorder', async () => {
    const user = userEvent.setup();
    render(<App />);

    const bijanRow = screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ });
    bijanRow.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');
    expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 1,/ })).toBeInTheDocument();

    const resetButton = screen.getByRole('button', { name: 'Reset to expert rankings' });
    await user.click(resetButton);
    await user.click(screen.getByRole('button', { name: 'Confirm reset?' }));

    expect(screen.getByRole('listitem', { name: /Jahmyr Gibbs, rank 1,/ })).toBeInTheDocument();
  });

  it('clears drafted state after two confirmed clicks', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' }));
    await user.click(screen.getByLabelText('Available only'));
    expect(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs available' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear drafted' }));
    await user.click(screen.getByRole('button', { name: 'Confirm clear?' }));

    expect(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' })).toBeInTheDocument();
  });

  it('undoes a cross-off with the Ctrl+Z keyboard shortcut (MVP 3.1)', async () => {
    const user = userEvent.setup();
    render(<App />);

    // Available-only (on by default) hides a just-drafted player, same as the other tests in
    // this file — turn it off so the row (and its now-relabelled button) stays visible to assert on.
    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' }));
    await user.click(screen.getByLabelText('Available only'));
    expect(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs available' })).toBeInTheDocument();

    // Clicking the checkbox above leaves focus ON it, and the shortcut deliberately ignores any
    // <input> target (see use-history-shortcuts.ts) — fire the keydown directly on window,
    // as if the shortcut were pressed with nothing in particular focused.
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' })).toBeInTheDocument();
  });

  it("keeps each format's drafted state independent when switching formats", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' }));

    await user.click(screen.getByRole('radio', { name: 'Dynasty Superflex' }));
    const searchBox = screen.getByLabelText('Search players by name or team');
    await user.type(searchBox, 'Jahmyr Gibbs');
    expect(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Redraft PPR' }));
    // Still drafted in this format, so Available-only (the default) now hides him here too —
    // switch it off to confirm the drafted state itself survived the round trip.
    await user.click(screen.getByLabelText('Available only'));
    expect(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs available' })).toBeInTheDocument();
  });
});
