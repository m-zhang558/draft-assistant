import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useBoardStore } from '@/state';
import { BoardManager } from './board-manager';
import { boardIdForFormat, resetBoardStore } from '../../../tests/test-store';

function statusRegion(): HTMLElement {
  return screen.getByRole('status', { name: 'Board management status' });
}

async function openPanel(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Manage boards' }));
}

describe('BoardManager', () => {
  beforeEach(async () => {
    await resetBoardStore();
  });

  it('creates a board, defaulting its name to the chosen format label, de-duplicated', async () => {
    const user = userEvent.setup();
    render(<BoardManager />);
    await openPanel(user);

    // Redraft PPR already exists (seeded), so the default name for another redraft-ppr board
    // is de-duplicated via domain/boards.ts nextBoardName.
    const nameInput = screen.getByLabelText('Name');
    expect(nameInput).toHaveValue('Redraft PPR (2)');

    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(useBoardStore.getState().boardIds).toHaveLength(3);
    expect(statusRegion()).toHaveTextContent('Created board "Redraft PPR (2)".');
  });

  it('rejects an empty board name inline, without calling the store or throwing', async () => {
    const user = userEvent.setup();
    render(<BoardManager />);
    await openPanel(user);

    const boardsBefore = useBoardStore.getState().boardIds.length;
    const nameInput = screen.getByLabelText('Name');
    await user.clear(nameInput);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(useBoardStore.getState().boardIds).toHaveLength(boardsBefore);
    expect(screen.getByText(/cannot be empty/i)).toBeInTheDocument();
  });

  it('renames the active board through validateBoardName, showing an inline error rather than throwing', async () => {
    const user = userEvent.setup();
    render(<BoardManager />);
    await openPanel(user);

    const renameInput = screen.getByLabelText(/New name for/);
    await user.clear(renameInput);
    await user.type(renameInput, '   ');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    const activeId = useBoardStore.getState().activeBoardId;
    expect(useBoardStore.getState().boards[activeId]?.name).toBe('Redraft PPR');
    expect(screen.getByText(/cannot be empty/i)).toBeInTheDocument();

    await user.clear(renameInput);
    await user.type(renameInput, 'My Redraft Board');
    await user.click(screen.getByRole('button', { name: 'Rename' }));

    expect(useBoardStore.getState().boards[activeId]?.name).toBe('My Redraft Board');
    expect(statusRegion()).toHaveTextContent('Renamed board to "My Redraft Board".');
  });

  it('duplicates the active board under a collision-avoiding name and activates the copy', async () => {
    const user = userEvent.setup();
    render(<BoardManager />);
    await openPanel(user);

    const sourceId = useBoardStore.getState().activeBoardId;
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));

    const state = useBoardStore.getState();
    expect(state.boardIds).toHaveLength(3);
    expect(state.activeBoardId).not.toBe(sourceId);
    expect(state.boards[state.activeBoardId]?.name).toBe('Redraft PPR (2)');
    expect(statusRegion()).toHaveTextContent('Duplicated "Redraft PPR" as "Redraft PPR (2)".');
  });

  it('deletes the active board behind a two-step ConfirmButton when more than one board remains', async () => {
    const user = userEvent.setup();
    act(() => {
      useBoardStore.getState().setActiveBoard(boardIdForFormat('redraft-ppr'));
    });
    render(<BoardManager />);
    await openPanel(user);

    expect(useBoardStore.getState().boardIds).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Delete board' }));
    // First click only arms the ConfirmButton — nothing deleted yet.
    expect(useBoardStore.getState().boardIds).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Confirm delete?' }));

    expect(useBoardStore.getState().boardIds).toHaveLength(1);
    expect(statusRegion()).toHaveTextContent('Deleted board "Redraft PPR".');
  });

  it('disables Delete, with an explanatory title, when only one board remains — never letting the store throw', async () => {
    const user = userEvent.setup();
    act(() => {
      const state = useBoardStore.getState();
      state.deleteBoard(boardIdForFormat('dynasty-sf'));
    });
    render(<BoardManager />);
    await openPanel(user);

    expect(useBoardStore.getState().boardIds).toHaveLength(1);

    const deleteButton = screen.getByRole('button', { name: 'Delete board' });
    expect(deleteButton).toBeDisabled();
    expect(deleteButton).toHaveAttribute('title', expect.stringMatching(/at least one board/i));
    // No ConfirmButton's armed "Confirm delete?" state exists at all — the control is a plain
    // disabled button, not a confirm flow the user could still trigger.
    expect(screen.queryByRole('button', { name: 'Confirm delete?' })).not.toBeInTheDocument();
  });

  it('lists every supported format in the create form', async () => {
    const user = userEvent.setup();
    render(<BoardManager />);
    await openPanel(user);

    const formatSelect = screen.getByLabelText('Format');
    expect(within(formatSelect).getByRole('option', { name: 'Redraft PPR' })).toBeInTheDocument();
    expect(
      within(formatSelect).getByRole('option', { name: 'Dynasty Superflex' })
    ).toBeInTheDocument();
  });
});
