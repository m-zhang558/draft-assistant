import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useBoardStore } from '@/state';
import { Board } from './board';

/**
 * The board store is a module-level singleton backed by real `window.localStorage`
 * (see phase2-contract.md §5). `localStorage.clear()` alone does not reset it between
 * tests in this file, because it only hydrates once at module load — so every test
 * explicitly drives it back to known defaults for BOTH formats.
 */
function resetStore() {
  const store = useBoardStore.getState();
  act(() => {
    store.setFormat('dynasty-sf');
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

/**
 * dnd-kit renders its own `role="status"` live region alongside ours (`@/ui`'s `LiveRegion`),
 * so `getByRole('status')` alone is ambiguous. Ours is the `aria-live="polite"` one — dnd-kit's
 * own default instructions/announcements region is `aria-live="assertive"`.
 */
function getBoardLiveRegion(): HTMLElement {
  const region = screen
    .getAllByRole('status')
    .find((element) => element.getAttribute('aria-live') === 'polite');
  if (!region) {
    throw new Error('expected a polite live region rendered by Board');
  }
  return region;
}

describe('Board', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
  });

  it('renders visible players ordered by rank, starting from the top of the board', () => {
    render(<Board />);

    const list = screen.getByRole('list', { name: 'Ranked players' });
    const rows = within(list).getAllByRole('listitem');
    const firstRow = rows[0];
    if (!firstRow) {
      throw new Error('expected at least one visible player row');
    }
    expect(within(firstRow).getByText('Jahmyr Gibbs')).toBeInTheDocument();
    // MVP 3.6: the row's accessible name conveys the row's real content (name, rank,
    // position, team, bye, tier) rather than the old artificial "name, rank N. Press
    // Alt+Up..." string that overrode it and hid everything but the name and rank.
    expect(firstRow).toHaveAttribute('aria-label', 'Jahmyr Gibbs, rank 1, RB, DET, bye 6, tier 1.');
  });

  it('renders only a windowed subset of the 426-player list, not every row (MVP 3.7)', () => {
    render(<Board />);

    const list = screen.getByRole('list', { name: 'Ranked players' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(426);
    // The list element itself is still sized for the FULL list, via absolute positioning —
    // only the rendered <li> count is windowed, not the scrollable height.
    expect(list).toHaveStyle({ position: 'relative' });
  });

  it('describes the Alt+Up/Down affordance via one shared instructions element, not a per-row copy', () => {
    render(<Board />);

    const list = screen.getByRole('list', { name: 'Ranked players' });
    const rows = within(list).getAllByRole('listitem');
    const describedByIds = new Set(rows.map((row) => row.getAttribute('aria-describedby')));

    // Every rendered row points at the SAME id.
    expect(describedByIds.size).toBe(1);
    const [instructionsId] = describedByIds;
    if (!instructionsId) {
      throw new Error('expected every row to carry an aria-describedby id');
    }

    // And that id resolves to exactly one element in the whole document — not one per row.
    expect(document.querySelectorAll(`#${instructionsId}`)).toHaveLength(1);
    expect(document.getElementById(instructionsId)).toHaveTextContent(/Alt\+Up/);
  });

  it('marks a tier band start with a heavier top border and an emphasised tier cell', () => {
    render(<Board />);

    // Jahmyr Gibbs (rank 1) is the very first player and the very first tier band.
    const firstRow = screen.getByRole('listitem', { name: /Jahmyr Gibbs, rank 1,/ });
    expect(firstRow).toHaveClass('border-t-accent');
  });

  it('does not mark a tier band on players the dataset has no tier for (K/DST)', () => {
    act(() => {
      useBoardStore.getState().setPosition('K');
    });
    render(<Board />);

    const list = screen.getByRole('list', { name: 'Ranked players' });
    const firstKRow = within(list).getAllByRole('listitem')[0];
    if (!firstKRow) {
      throw new Error('expected at least one K row in redraft-ppr');
    }
    expect(firstKRow).not.toHaveClass('border-t-accent');
  });

  it('crosses a player off in one click: strike-through text and aria-pressed, not colour alone', async () => {
    const user = userEvent.setup();
    // Available-only has no toggle control in this isolated render (that lives in
    // AvailabilityToggle) — turn it off directly so the drafted row stays visible to assert on.
    act(() => {
      useBoardStore.getState().setAvailableOnly(false);
    });
    render(<Board />);

    const draftButton = screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' });
    expect(draftButton).toHaveAttribute('aria-pressed', 'false');

    await user.click(draftButton);

    const undoButton = screen.getByRole('button', { name: 'Mark Jahmyr Gibbs available' });
    expect(undoButton).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Jahmyr Gibbs')).toHaveClass('line-through');
  });

  it('announces a cross-off toggle through the live region (MVP 3.6)', async () => {
    const user = userEvent.setup();
    act(() => {
      useBoardStore.getState().setAvailableOnly(false);
    });
    render(<Board />);

    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' }));

    expect(getBoardLiveRegion()).toHaveTextContent('Jahmyr Gibbs marked drafted.');

    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs available' }));

    expect(getBoardLiveRegion()).toHaveTextContent('Jahmyr Gibbs marked available.');
  });

  it('moves the focused row with Alt+ArrowUp, updates the displayed rank, and keeps focus on it', () => {
    render(<Board />);

    const row = screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ });
    row.focus();
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true });

    const movedRow = screen.getByRole('listitem', { name: /Bijan Robinson, rank 1,/ });
    expect(movedRow).toBeInTheDocument();
    expect(screen.getByRole('listitem', { name: /Jahmyr Gibbs, rank 2,/ })).toBeInTheDocument();
    // Focus follows the move rather than being dropped onto <body> — the crux of MVP 3.7's
    // "keyboard moves must not lose the row" requirement.
    expect(document.activeElement).toBe(movedRow);
  });

  it('announces a keyboard reorder through the live region (MVP 3.6)', () => {
    render(<Board />);

    const row = screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ });
    row.focus();
    fireEvent.keyDown(row, { key: 'ArrowUp', altKey: true });

    expect(getBoardLiveRegion()).toHaveTextContent('Bijan Robinson moved to rank 1.');
  });

  it('keeps focus on the moved row across many keyboard moves, well past the initially rendered window', () => {
    render(<Board />);

    const startRow = screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ });
    startRow.focus();

    const moveCount = 30;
    for (let i = 0; i < moveCount; i += 1) {
      const focused = document.activeElement;
      if (!(focused instanceof HTMLLIElement)) {
        throw new Error(
          `expected an <li> to be focused before move ${i}, got ${focused?.tagName ?? 'null'}`
        );
      }
      fireEvent.keyDown(focused, { key: 'ArrowDown', altKey: true });
    }

    // Started at rank 2, moved down 30 times -> rank 32.
    const finalRow = screen.getByRole('listitem', { name: /Bijan Robinson, rank 32,/ });
    expect(document.activeElement).toBe(finalRow);
  });

  it('shows a position-specific empty state when the format does not rank that position', () => {
    act(() => {
      useBoardStore.getState().setFormat('dynasty-sf');
      useBoardStore.getState().setPosition('K');
    });

    render(<Board />);

    expect(screen.getByText(/Dynasty Superflex doesn.t rank K\./)).toBeInTheDocument();
  });

  it('shows a "drafted" empty state, distinct from no results, when Available only hides everyone matching', async () => {
    const user = userEvent.setup();
    act(() => {
      useBoardStore.getState().setSearch('Jahmyr Gibbs');
    });

    render(<Board />);

    await user.click(screen.getByRole('button', { name: 'Mark Jahmyr Gibbs drafted' }));

    expect(screen.getByText(/Everyone matching your filters has been drafted/)).toBeInTheDocument();
  });

  it('shows a no-search-match empty state when nothing matches the query', () => {
    act(() => {
      useBoardStore.getState().setSearch('zzznotarealplayerzzz');
    });

    render(<Board />);

    expect(screen.getByText('No players match "zzznotarealplayerzzz".')).toBeInTheDocument();
  });
});
