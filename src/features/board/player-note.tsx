/**
 * Per-player note (MVP 4.7): a small inline editor opened from a row, with the trigger button
 * itself indicating whether a note already exists (a pencil glyph plus a filled dot — a shape
 * difference, not a colour one — never colour alone, PROJECT.md §6).
 *
 * --- Row height stays single-source (PROJECT.md §8 / `row-grid.ts` `resolveRowHeight`) ---
 *
 * The editor is rendered as a `position: absolute` overlay nested inside this component's own
 * root `<span>`, dropping below the row (`top: 100%`) rather than participating in the row's own
 * box. Absolutely positioned children are removed from normal flow, so they never contribute to
 * their (non-`static`) ancestor's height — opening the editor cannot change the fixed `height`
 * `player-row.tsx` sets on the `<li>`, which is what the virtualiser's `index * rowHeight`
 * arithmetic depends on staying exact. A layout-measured popover (portal + `getBoundingClientRect`)
 * was deliberately not used instead: `jsdom` performs no layout (PROJECT.md §4 — the same reason
 * this project carries no Playwright), so a rect-based position could not be verified by
 * `npm run test`, only eyeballed by hand. The trade-off is that a row very near the bottom of the
 * scrollable list can have its open editor clipped by the list's own `overflow-y: auto` — an
 * accepted cost, not an oversight.
 *
 * --- Commit semantics ---
 *
 * Commits on blur or Enter, cancels on Escape without committing — never per keystroke, since
 * every keystroke would otherwise be a `setNote` database write (`board-store.ts`). Escape sets
 * `cancelledRef` before closing so the `blur` that follows (the input leaving focus as it
 * unmounts) is not read as a second, overriding commit.
 *
 * --- Keyboard isolation from the row it lives in ---
 *
 * The `<li>` this renders inside (`player-row.tsx`) handles Alt+ArrowUp/Down itself, and its
 * drag-handle sibling carries dnd-kit's keyboard-drag `listeners` (Space to lift, arrows to
 * move). Those `listeners` are spread only on that handle button, never on this input, so Space
 * typed here cannot reach dnd-kit at all; `handleKeyDown` below still calls
 * `event.stopPropagation()` on every key so a future row-level shortcut can never intercept a
 * keystroke meant for the note text (verified by a component test — this is the "most likely to
 * be silently broken" case the spec calls out).
 */
import { useRef, useState, type KeyboardEvent } from 'react';

export interface PlayerNoteProps {
  playerId: string;
  playerName: string;
  /** `undefined` (or empty) means "no note" — mirrors `board-store.ts`'s `notes` map, which never
   * holds an empty-string entry. */
  note: string | undefined;
  onCommit: (playerId: string, note: string) => void;
  /** Merged onto the root `<span>` — `player-row.tsx` passes `NARROW_HIDDEN` plus `relative` so
   * this stays the positioning anchor for its own popover. */
  className?: string;
}

export function PlayerNote({ playerId, playerName, note, onCommit, className }: PlayerNoteProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelledRef = useRef(false);

  const hasNote = note !== undefined && note !== '';

  function openEditor() {
    setDraft(note ?? '');
    cancelledRef.current = false;
    setOpen(true);
  }

  function commitAndClose() {
    onCommit(playerId, draft);
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Isolate every keystroke from the row's own Alt+Arrow handler and (transitively) dnd-kit's
    // keyboard-drag listeners — see file header.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commitAndClose();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelledRef.current = true;
      setOpen(false);
    }
  }

  function handleBlur() {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    commitAndClose();
  }

  return (
    <span className={className}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={hasNote ? `Edit note for ${playerName}` : `Add note for ${playerName}`}
        title={hasNote ? note : undefined}
        onClick={() => (open ? setOpen(false) : openEditor())}
        className={[
          'rounded p-1 text-sm leading-none hover:bg-surface-muted',
          hasNote ? 'font-bold text-accent' : 'text-text-muted',
        ].join(' ')}
      >
        {hasNote ? '✎•' : '✎'}
      </button>
      {open ? (
        <span className="absolute right-0 top-full z-30 mt-1 block w-56 rounded-md border border-border bg-surface p-2 shadow-lg">
          <label htmlFor={`player-note-input-${playerId}`} className="sr-only">
            Note for {playerName}
          </label>
          <input
            id={`player-note-input-${playerId}`}
            type="text"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="e.g. hamstring, monitor Thursday"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p className="mt-1 text-xs text-text-muted">Enter to save, Esc to cancel.</p>
        </span>
      ) : null}
    </span>
  );
}
