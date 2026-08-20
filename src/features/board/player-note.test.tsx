import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PlayerNote } from './player-note';

describe('PlayerNote', () => {
  it('shows an outline pencil with no note, and a filled indicator once a note exists', () => {
    const { rerender } = render(
      <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note={undefined} onCommit={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: "Add note for Ja'Marr Chase" })).toHaveTextContent(
      '✎'
    );

    rerender(
      <PlayerNote
        playerId="p1"
        playerName="Ja'Marr Chase"
        note="hamstring, monitor Thursday"
        onCommit={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: "Edit note for Ja'Marr Chase" });
    expect(trigger).toHaveTextContent('✎•');
    expect(trigger).toHaveAttribute('title', 'hamstring, monitor Thursday');
  });

  it('opens the editor pre-filled with the existing note and commits the edit on Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note="old note" onCommit={onCommit} />
    );

    await user.click(screen.getByRole('button', { name: "Edit note for Ja'Marr Chase" }));
    const input = screen.getByLabelText("Note for Ja'Marr Chase");
    expect(input).toHaveValue('old note');

    await user.clear(input);
    await user.type(input, 'hamstring, monitor Thursday{Enter}');

    expect(onCommit).toHaveBeenCalledWith('p1', 'hamstring, monitor Thursday');
    // The editor closes on commit.
    expect(screen.queryByLabelText("Note for Ja'Marr Chase")).not.toBeInTheDocument();
  });

  it('commits on blur without requiring Enter', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <>
        <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note={undefined} onCommit={onCommit} />
        <button type="button">elsewhere</button>
      </>
    );

    await user.click(screen.getByRole('button', { name: "Add note for Ja'Marr Chase" }));
    await user.type(screen.getByLabelText("Note for Ja'Marr Chase"), 'quad, day-to-day');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    expect(onCommit).toHaveBeenCalledWith('p1', 'quad, day-to-day');
  });

  it('Escape cancels without committing, discarding the edit', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note="old note" onCommit={onCommit} />
    );

    await user.click(screen.getByRole('button', { name: "Edit note for Ja'Marr Chase" }));
    const input = screen.getByLabelText("Note for Ja'Marr Chase");
    await user.clear(input);
    await user.type(input, 'this should not be saved');

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Note for Ja'Marr Chase")).not.toBeInTheDocument();
  });

  it('clearing the note commits an empty string (the store treats that as "no note")', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note="old note" onCommit={onCommit} />
    );

    await user.click(screen.getByRole('button', { name: "Edit note for Ja'Marr Chase" }));
    await user.clear(screen.getByLabelText("Note for Ja'Marr Chase"));
    fireEvent.keyDown(screen.getByLabelText("Note for Ja'Marr Chase"), { key: 'Enter' });

    expect(onCommit).toHaveBeenCalledWith('p1', '');
  });

  it('does not commit per keystroke — onCommit fires only on blur/Enter, not while typing', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(
      <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note={undefined} onCommit={onCommit} />
    );

    await user.click(screen.getByRole('button', { name: "Add note for Ja'Marr Chase" }));
    await user.type(screen.getByLabelText("Note for Ja'Marr Chase"), 'typing without committing');

    expect(onCommit).not.toHaveBeenCalled();
  });

  it('stops every keydown from bubbling out of the input, including a bare Space', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <PlayerNote playerId="p1" playerName="Ja'Marr Chase" note={undefined} onCommit={onCommit} />
      </div>
    );

    await user.click(screen.getByRole('button', { name: "Add note for Ja'Marr Chase" }));
    await user.type(screen.getByLabelText("Note for Ja'Marr Chase"), 'a b c');

    // Every keystroke, including the spaces, stayed inside the input — none reached the
    // surrounding row's own keydown handler (which in the real row is where Alt+Arrow reorder
    // and dnd-kit's Space-to-lift keyboard drag would otherwise be able to intercept it).
    expect(onParentKeyDown).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Note for Ja'Marr Chase")).toHaveValue('a b c');
  });
});
