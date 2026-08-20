import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useBoardStore } from '@/state';
import { Board } from './board';
import { NARROW_QUERY } from './row-grid';
import { boardIdForFormat, resetBoardStore } from '../../../tests/test-store';
import { setMatchMediaQuery } from '../../../tests/setup';

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
  beforeEach(async () => {
    // The `matchMedia` shim (tests/setup.ts) keeps its match state per query string across
    // tests — reset to "wide" so a narrow-width test never leaks into the next one.
    setMatchMediaQuery(NARROW_QUERY, false);
    await resetBoardStore();
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
      useBoardStore.getState().setActiveBoard(boardIdForFormat('dynasty-sf'));
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

  it('toggles watchlist status via the star, conveyed by glyph and aria-pressed (not colour alone), and announces it (MVP 4.8)', async () => {
    const user = userEvent.setup();
    render(<Board />);

    const outlineStar = screen.getByRole('button', { name: 'Add Jahmyr Gibbs to watchlist' });
    expect(outlineStar).toHaveAttribute('aria-pressed', 'false');
    expect(outlineStar).toHaveTextContent('☆');

    await user.click(outlineStar);

    const filledStar = screen.getByRole('button', { name: 'Remove Jahmyr Gibbs from watchlist' });
    expect(filledStar).toHaveAttribute('aria-pressed', 'true');
    expect(filledStar).toHaveTextContent('★');
    expect(getBoardLiveRegion()).toHaveTextContent('Jahmyr Gibbs added to watchlist.');

    await user.click(filledStar);
    expect(screen.getByRole('button', { name: 'Add Jahmyr Gibbs to watchlist' })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
    expect(getBoardLiveRegion()).toHaveTextContent('Jahmyr Gibbs removed from watchlist.');
  });

  it('the "Watched only" filter hides players not on the watchlist, independent of Available only (MVP 4.8)', async () => {
    const user = userEvent.setup();
    render(<Board />);

    await user.click(screen.getByRole('button', { name: 'Add Bijan Robinson to watchlist' }));

    act(() => {
      useBoardStore.getState().setWatchedOnly(true);
    });

    const list = screen.getByRole('list', { name: 'Ranked players' });
    expect(within(list).getByText('Bijan Robinson')).toBeInTheDocument();
    expect(within(list).queryByText('Jahmyr Gibbs')).not.toBeInTheDocument();
  });

  it('shows a "watched" empty state, distinct from the others, when Watched only hides everyone matching', () => {
    act(() => {
      useBoardStore.getState().setWatchedOnly(true);
    });

    render(<Board />);

    expect(
      screen.getByText(/Nobody matching your filters is on your watchlist/)
    ).toBeInTheDocument();
  });

  it('a custom tier break replaces the source tiers entirely (all-or-nothing), and the reset control restores them (MVP 4.9)', async () => {
    const user = userEvent.setup();
    render(<Board />);

    // Under the SOURCE's own tiers, Jahmyr Gibbs (rank 1) starts the first band.
    expect(screen.getByRole('listitem', { name: /Jahmyr Gibbs, rank 1,/ })).toHaveClass(
      'border-t-accent'
    );
    expect(screen.queryByText(/Custom tiers ·/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start a tier at Bijan Robinson' }));

    // All-or-nothing (domain/tiers.ts resolveTierStarts): the one custom break becomes the ONLY
    // tier start on the board — Jahmyr Gibbs loses its band start even though its own `tier`
    // field never changed.
    expect(screen.getByRole('listitem', { name: /Jahmyr Gibbs, rank 1,/ })).not.toHaveClass(
      'border-t-accent'
    );
    expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ })).toHaveClass(
      'border-t-accent'
    );
    expect(screen.getByText(/Custom tiers ·/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove tier break at Bijan Robinson' })
    ).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Reset to source tiers' }));

    expect(screen.getByRole('listitem', { name: /Jahmyr Gibbs, rank 1,/ })).toHaveClass(
      'border-t-accent'
    );
    expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ })).not.toHaveClass(
      'border-t-accent'
    );
    expect(screen.queryByText(/Custom tiers ·/)).not.toBeInTheDocument();
  });

  it('typing in a player note — including Space — never reorders the row or triggers dnd-kit keyboard drag (MVP 4.7)', async () => {
    const user = userEvent.setup();
    render(<Board />);

    await user.click(screen.getByRole('button', { name: 'Add note for Bijan Robinson' }));
    const input = screen.getByLabelText('Note for Bijan Robinson');

    await user.type(input, 'hamstring, monitor Thursday');
    expect(input).toHaveValue('hamstring, monitor Thursday');

    // Still rank 2: nothing about typing (including the spaces) moved the row or lifted it into
    // a drag.
    expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ })).toBeInTheDocument();

    await user.keyboard('{Enter}');

    expect(getBoardLiveRegion()).toHaveTextContent('Note saved for Bijan Robinson.');
    expect(screen.getByRole('button', { name: 'Edit note for Bijan Robinson' })).toHaveTextContent(
      '✎•'
    );
    // Still rank 2 after commit, too.
    expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ })).toBeInTheDocument();
  });

  it("Escape in a player's note editor cancels without saving or moving the row (MVP 4.7)", async () => {
    const user = userEvent.setup();
    render(<Board />);

    await user.click(screen.getByRole('button', { name: 'Add note for Bijan Robinson' }));
    await user.type(screen.getByLabelText('Note for Bijan Robinson'), 'should not be saved');
    await user.keyboard('{Escape}');

    expect(screen.getByRole('button', { name: 'Add note for Bijan Robinson' })).toHaveTextContent(
      '✎'
    );
    expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ })).toBeInTheDocument();
  });

  it('clearing custom tier breaks is undoable in a single press, not once per break (Stage E)', async () => {
    const user = userEvent.setup();
    render(<Board />);

    await user.click(screen.getByRole('button', { name: 'Start a tier at Bijan Robinson' }));
    await user.click(screen.getByRole('button', { name: "Start a tier at Ja'Marr Chase" }));
    expect(useBoardStore.getState().canUndo).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Reset to source tiers' }));
    expect(screen.queryByText(/Custom tiers ·/)).not.toBeInTheDocument();

    // One Ctrl+Z (a single history entry) restores EVERY cleared break, not just the last one.
    act(() => {
      useBoardStore.getState().undo();
    });

    expect(screen.getByText(/Custom tiers ·/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remove tier break at Bijan Robinson' })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(
      screen.getByRole('button', { name: "Remove tier break at Ja'Marr Chase" })
    ).toHaveAttribute('aria-pressed', 'true');
  });

  describe('at a narrow (phone) width', () => {
    beforeEach(() => {
      setMatchMediaQuery(NARROW_QUERY, true);
    });

    it('exposes note and tier-break through a single overflow control, not directly (Stage E)', async () => {
      const user = userEvent.setup();
      render(<Board />);

      // The wide-width controls are gone from this row entirely (a JS conditional, not a CSS
      // hide) — see row-grid.ts's file header for why.
      expect(
        screen.queryByRole('button', { name: 'Add note for Bijan Robinson' })
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Start a tier at Bijan Robinson' })
      ).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'More actions for Bijan Robinson' }));

      const input = screen.getByLabelText('Note for Bijan Robinson');
      await user.type(input, 'hamstring, monitor Thursday{Enter}');

      expect(getBoardLiveRegion()).toHaveTextContent('Note saved for Bijan Robinson.');
      expect(
        screen.getByRole('button', { name: 'More actions for Bijan Robinson' })
      ).toHaveTextContent('⋯•');

      await user.click(screen.getByRole('button', { name: 'More actions for Bijan Robinson' }));
      await user.click(screen.getByRole('button', { name: 'Start a tier at Bijan Robinson' }));

      expect(getBoardLiveRegion()).toHaveTextContent('Tier now starts at Bijan Robinson.');
      expect(screen.getByRole('listitem', { name: /Bijan Robinson, rank 2,/ })).toHaveClass(
        'border-t-accent'
      );
    });
  });
});
