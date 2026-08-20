import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RowOverflowMenu } from './row-overflow';

describe('RowOverflowMenu', () => {
  it('shows a plain trigger with neither a note nor a tier break, and a filled one once either exists', () => {
    const { rerender } = render(
      <RowOverflowMenu
        playerId="p1"
        playerName="Ja'Marr Chase"
        note={undefined}
        onSetNote={vi.fn()}
        hasTierBreak={false}
        onToggleTierBreak={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: "More actions for Ja'Marr Chase" })
    ).toHaveTextContent('⋯');

    rerender(
      <RowOverflowMenu
        playerId="p1"
        playerName="Ja'Marr Chase"
        note="hamstring"
        onSetNote={vi.fn()}
        hasTierBreak={false}
        onToggleTierBreak={vi.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: "More actions for Ja'Marr Chase" })
    ).toHaveTextContent('⋯•');
  });

  it('opens the note field pre-filled and commits the edit on Enter, closing the popover', async () => {
    const user = userEvent.setup();
    const onSetNote = vi.fn();
    render(
      <RowOverflowMenu
        playerId="p1"
        playerName="Ja'Marr Chase"
        note="old note"
        onSetNote={onSetNote}
        hasTierBreak={false}
        onToggleTierBreak={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: "More actions for Ja'Marr Chase" }));
    const input = screen.getByLabelText("Note for Ja'Marr Chase");
    expect(input).toHaveValue('old note');

    await user.clear(input);
    await user.type(input, 'new note{Enter}');

    expect(onSetNote).toHaveBeenCalledWith('p1', 'new note');
    expect(screen.queryByLabelText("Note for Ja'Marr Chase")).not.toBeInTheDocument();
  });

  it('commits the note on blur without requiring Enter', async () => {
    const user = userEvent.setup();
    const onSetNote = vi.fn();
    render(
      <>
        <RowOverflowMenu
          playerId="p1"
          playerName="Ja'Marr Chase"
          note={undefined}
          onSetNote={onSetNote}
          hasTierBreak={false}
          onToggleTierBreak={vi.fn()}
        />
        <button type="button">elsewhere</button>
      </>
    );

    await user.click(screen.getByRole('button', { name: "More actions for Ja'Marr Chase" }));
    await user.type(screen.getByLabelText("Note for Ja'Marr Chase"), 'quad');
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));

    expect(onSetNote).toHaveBeenCalledWith('p1', 'quad');
  });

  it('Escape cancels the note edit without committing', async () => {
    const user = userEvent.setup();
    const onSetNote = vi.fn();
    render(
      <RowOverflowMenu
        playerId="p1"
        playerName="Ja'Marr Chase"
        note="old note"
        onSetNote={onSetNote}
        hasTierBreak={false}
        onToggleTierBreak={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: "More actions for Ja'Marr Chase" }));
    const input = screen.getByLabelText("Note for Ja'Marr Chase");
    await user.clear(input);
    await user.type(input, 'should not save');
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(onSetNote).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Note for Ja'Marr Chase")).not.toBeInTheDocument();
  });

  it('toggles the tier break from inside the popover', async () => {
    const user = userEvent.setup();
    const onToggleTierBreak = vi.fn();
    render(
      <RowOverflowMenu
        playerId="p1"
        playerName="Ja'Marr Chase"
        note={undefined}
        onSetNote={vi.fn()}
        hasTierBreak={false}
        onToggleTierBreak={onToggleTierBreak}
      />
    );

    await user.click(screen.getByRole('button', { name: "More actions for Ja'Marr Chase" }));
    await user.click(screen.getByRole('button', { name: "Start a tier at Ja'Marr Chase" }));

    expect(onToggleTierBreak).toHaveBeenCalledWith('p1');
  });

  it('stops every keydown in the note input from bubbling out, including a bare Space', async () => {
    const user = userEvent.setup();
    const onParentKeyDown = vi.fn();
    render(
      <div onKeyDown={onParentKeyDown}>
        <RowOverflowMenu
          playerId="p1"
          playerName="Ja'Marr Chase"
          note={undefined}
          onSetNote={vi.fn()}
          hasTierBreak={false}
          onToggleTierBreak={vi.fn()}
        />
      </div>
    );

    await user.click(screen.getByRole('button', { name: "More actions for Ja'Marr Chase" }));
    await user.type(screen.getByLabelText("Note for Ja'Marr Chase"), 'a b c');

    expect(onParentKeyDown).not.toHaveBeenCalled();
  });
});
