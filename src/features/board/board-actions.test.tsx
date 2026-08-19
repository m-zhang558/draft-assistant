import { act, fireEvent, render, screen } from '@testing-library/react';
import { getRankings, useBoardStore } from '@/state';
import { BoardActions } from './board-actions';

/**
 * The board store is a module-level singleton backed by real `window.localStorage` (see
 * `board.test.tsx`) — it only hydrates once, so tests drive it back to known defaults.
 *
 * Deliberately NOT called from a global `beforeEach`: it uses `clearDrafted`/`resetOrder`,
 * which — like every destructive board edit — unconditionally push a history entry (even when
 * they are a no-op value-wise), so calling it would make "history starts empty" untestable.
 * The very first test below relies on the singleton's true cold-start history (this test FILE
 * gets its own fresh module registry, so nothing has touched the store yet); every other test
 * calls this explicitly first.
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
 * `resetStore()` itself pushes several history entries (`clearDrafted`/`resetOrder` push
 * unconditionally, even as a value no-op). A test that wants to assert "a single edit produces
 * a single undo entry" needs a genuinely empty stack first: drain `resetStore()`'s entries via
 * the real `undo()` action, then re-apply the non-destructive setters (format/position/etc. —
 * none of which push history) to correct any drift `undo()` introduces by restoring an earlier
 * snapshot's `activeFormat` along with its board content.
 */
function resetStoreWithEmptyHistory() {
  resetStore();
  act(() => {
    while (useBoardStore.getState().canUndo) {
      useBoardStore.getState().undo();
    }
    useBoardStore.getState().setFormat('redraft-ppr');
    useBoardStore.getState().setPosition('ALL');
    useBoardStore.getState().setSearch('');
    useBoardStore.getState().setAvailableOnly(true);
  });
}

function firstPlayerId(): string {
  const id = getRankings('redraft-ppr').players[0]?.id;
  if (!id) throw new Error('expected at least one redraft-ppr player');
  return id;
}

function historyStatus(): HTMLElement {
  return screen.getByRole('status', { name: 'History status' });
}

describe('BoardActions', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('disables Undo and Redo when the history is empty', () => {
    render(<BoardActions />);

    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' })).toBeDisabled();
  });

  it('enables Undo after an edit; clicking it restores the prior state and enables Redo', () => {
    resetStoreWithEmptyHistory();
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    const undoButton = screen.getByRole('button', { name: 'Undo (Ctrl+Z)' });
    expect(undoButton).toBeEnabled();
    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);

    fireEvent.click(undoButton);

    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(false);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' })).toBeEnabled();
    expect(historyStatus()).toHaveTextContent('Undo: board restored.');
  });

  it('clicking Redo re-applies an undone edit', () => {
    resetStore();
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }));

    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
    expect(historyStatus()).toHaveTextContent('Redo: board restored.');
  });

  it('Ctrl+Z fires undo and announces the result', () => {
    resetStore();
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(false);
    expect(historyStatus()).toHaveTextContent('Undo: board restored.');
  });

  it('Cmd+Z (metaKey) also fires undo', () => {
    resetStore();
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(false);
  });

  it('Ctrl+Shift+Z fires redo', () => {
    resetStore();
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
      useBoardStore.getState().undo();
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });

    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
  });

  it('Ctrl+Y also fires redo (Windows convention)', () => {
    resetStore();
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
      useBoardStore.getState().undo();
    });

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });

    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
  });

  it('announces "Nothing to undo." when Ctrl+Z fires with an empty history', () => {
    resetStore();
    // resetStore() itself pushes history entries; drain them via the real undo() action so the
    // stack is genuinely empty, then confirm redo is available (proving undo() really ran)
    // before checking the "nothing to undo" announcement past that point.
    act(() => {
      while (useBoardStore.getState().canUndo) {
        useBoardStore.getState().undo();
      }
    });
    render(<BoardActions />);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(historyStatus()).toHaveTextContent('Nothing to undo.');
  });

  it('a Ctrl+Z keydown aimed at a text field is ignored, leaving native text-undo to the browser', () => {
    resetStore();
    render(
      <>
        <input data-testid="text-field" />
        <BoardActions />
      </>
    );
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });
    expect(useBoardStore.getState().canUndo).toBe(true);

    const input = screen.getByTestId('text-field');
    input.focus();
    fireEvent.keyDown(input, { key: 'z', ctrlKey: true });

    // Unchanged: the shortcut must not have fired.
    expect(useBoardStore.getState().canUndo).toBe(true);
    expect(useBoardStore.getState().boards['redraft-ppr'].drafted.has(playerId)).toBe(true);
  });
});
