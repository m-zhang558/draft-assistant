import { act, fireEvent, render, screen } from '@testing-library/react';
import { activeBoard, getRankings, useBoardStore } from '@/state';
import { BoardActions } from './board-actions';
import { resetBoardStore } from '../../../tests/test-store';

function firstPlayerId(): string {
  const id = getRankings('redraft-ppr').players[0]?.id;
  if (!id) throw new Error('expected at least one redraft-ppr player');
  return id;
}

function historyStatus(): HTMLElement {
  return screen.getByRole('status', { name: 'History status' });
}

function isDrafted(playerId: string): boolean {
  return activeBoard(useBoardStore.getState()).drafted.has(playerId);
}

describe('BoardActions', () => {
  // Every `resetBoardStore()` call re-initialises the store from a fresh cold-start database,
  // which always starts with an empty undo/redo stack (`EMPTY_HISTORY`) — no draining or
  // hand-rebuilding needed, unlike the old localStorage-singleton reset this replaces.
  beforeEach(async () => {
    await resetBoardStore();
  });

  it('disables Undo and Redo when the history is empty', () => {
    render(<BoardActions />);

    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' })).toBeDisabled();
  });

  it('enables Undo after an edit; clicking it restores the prior state and enables Redo', () => {
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    const undoButton = screen.getByRole('button', { name: 'Undo (Ctrl+Z)' });
    expect(undoButton).toBeEnabled();
    expect(isDrafted(playerId)).toBe(true);

    fireEvent.click(undoButton);

    expect(isDrafted(playerId)).toBe(false);
    expect(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' })).toBeEnabled();
    expect(historyStatus()).toHaveTextContent('Undo: board restored.');
  });

  it('clicking Redo re-applies an undone edit', () => {
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Undo (Ctrl+Z)' }));

    fireEvent.click(screen.getByRole('button', { name: 'Redo (Ctrl+Shift+Z)' }));

    expect(isDrafted(playerId)).toBe(true);
    expect(historyStatus()).toHaveTextContent('Redo: board restored.');
  });

  it('Ctrl+Z fires undo and announces the result', () => {
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(isDrafted(playerId)).toBe(false);
    expect(historyStatus()).toHaveTextContent('Undo: board restored.');
  });

  it('Cmd+Z (metaKey) also fires undo', () => {
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    fireEvent.keyDown(window, { key: 'z', metaKey: true });

    expect(isDrafted(playerId)).toBe(false);
  });

  it('Ctrl+Shift+Z fires redo', () => {
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
      useBoardStore.getState().undo();
    });

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });

    expect(isDrafted(playerId)).toBe(true);
  });

  it('Ctrl+Y also fires redo (Windows convention)', () => {
    render(<BoardActions />);
    const playerId = firstPlayerId();

    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
      useBoardStore.getState().undo();
    });

    fireEvent.keyDown(window, { key: 'y', ctrlKey: true });

    expect(isDrafted(playerId)).toBe(true);
  });

  it('announces "Nothing to undo." when Ctrl+Z fires with an empty history', () => {
    render(<BoardActions />);

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

    expect(historyStatus()).toHaveTextContent('Nothing to undo.');
  });

  it('a Ctrl+Z keydown aimed at a text field is ignored, leaving native text-undo to the browser', () => {
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
    expect(isDrafted(playerId)).toBe(true);
  });
});
