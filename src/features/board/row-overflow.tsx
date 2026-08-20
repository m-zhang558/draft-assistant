/**
 * Narrow-width overflow control (Stage E fix for a Stage D gap): below `sm`, `player-row.tsx`
 * renders THIS instead of the direct note button + tier-break button, so both MVP 4.7 (notes)
 * and MVP 4.9 (custom tier breaks) stay reachable on a phone-width board — Stage D folded both
 * into `NARROW_HIDDEN` with no substitute, which meant they simply did not exist below 640px
 * (PROJECT.md §3.5/§6: an absent-below-a-breakpoint feature is not an acceptable resolution).
 *
 * One "⋯" trigger opens a popover exposing both controls together. `row-grid.ts`'s file header
 * explains why this is a JS conditional (driven by the same `isNarrow` boolean `resolveRowHeight`
 * already trusts) rather than a second `NARROW_HIDDEN`-style CSS-hidden copy of the wide-width
 * controls: `jsdom` applies no stylesheet, so two simultaneously *mounted* controls sharing an
 * accessible name would be ambiguous to a test query (and to any assistive tech that has not yet
 * applied the stylesheet). Rendering exactly one of the two DOM shapes at a time sidesteps that
 * outright.
 *
 * The note field here is a self-contained editor rather than a nested `player-note.tsx`
 * `PlayerNote`: nesting `PlayerNote`'s own pencil trigger inside this popover would cost a second
 * click to reach a note (open the overflow, THEN open the note editor) and would reintroduce a
 * second "Add note for X" / "Edit note for X" control elsewhere on the page. Commit-on-blur/Enter
 * and cancel-on-Escape mirror `player-note.tsx` exactly, for the same reasons documented there:
 * never a per-keystroke `setNote` write, and every keydown stops propagation before it can reach
 * the row's own Alt+Arrow handler or (transitively) dnd-kit's keyboard-drag listeners.
 *
 * Row height stays single-source (PROJECT.md §8 / `row-grid.ts` `resolveRowHeight`): like
 * `PlayerNote`'s editor, the popover is a `position: absolute` overlay nested in its own root
 * `<span>`, removed from normal flow, so opening it cannot change the row's fixed inline
 * `height`.
 */
import { useRef, useState, type KeyboardEvent } from 'react';

export interface RowOverflowMenuProps {
  playerId: string;
  playerName: string;
  /** `undefined` (or empty) means "no note" — mirrors `board-store.ts`'s `notes` map. */
  note: string | undefined;
  onSetNote: (playerId: string, note: string) => void;
  hasTierBreak: boolean;
  onToggleTierBreak: (playerId: string) => void;
  /** Merged onto the root `<span>` — `player-row.tsx` passes `relative` so this stays the
   * positioning anchor for its own popover. */
  className?: string;
}

export function RowOverflowMenu({
  playerId,
  playerName,
  note,
  onSetNote,
  hasTierBreak,
  onToggleTierBreak,
  className,
}: RowOverflowMenuProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const cancelledRef = useRef(false);

  const hasNote = note !== undefined && note !== '';
  const hasAny = hasNote || hasTierBreak;

  function openMenu() {
    setDraft(note ?? '');
    cancelledRef.current = false;
    setOpen(true);
  }

  function commitNote() {
    onSetNote(playerId, draft);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Isolate every keystroke from the row's own Alt+Arrow handler and (transitively) dnd-kit's
    // keyboard-drag listeners — see file header, matches player-note.tsx.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commitNote();
      setOpen(false);
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
    commitNote();
  }

  return (
    <span className={className}>
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={`More actions for ${playerName}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        className={[
          'rounded p-1 text-sm leading-none hover:bg-surface-muted',
          hasAny ? 'font-bold text-accent' : 'text-text-muted',
        ].join(' ')}
      >
        {hasAny ? '⋯•' : '⋯'}
      </button>
      {open ? (
        <span className="absolute right-0 top-full z-30 mt-1 flex w-56 flex-col gap-2 rounded-md border border-border bg-surface p-2 shadow-lg">
          <label htmlFor={`row-overflow-note-${playerId}`} className="text-xs text-text-muted">
            Note for {playerName}
          </label>
          <input
            id={`row-overflow-note-${playerId}`}
            type="text"
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            placeholder="e.g. hamstring, monitor Thursday"
            className="w-full rounded border border-border bg-surface px-2 py-1 text-sm text-text-primary outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
          />
          <p className="text-xs text-text-muted">Enter to save, Esc to cancel.</p>
          <button
            type="button"
            aria-pressed={hasTierBreak}
            aria-label={
              hasTierBreak ? `Remove tier break at ${playerName}` : `Start a tier at ${playerName}`
            }
            onClick={() => onToggleTierBreak(playerId)}
            className="flex items-center justify-between rounded p-1 text-xs font-medium text-text-muted hover:bg-surface-muted aria-pressed:text-accent"
          >
            <span>Tier break</span>
            <span>{hasTierBreak ? '▪' : '▭'}</span>
          </button>
        </span>
      ) : null}
    </span>
  );
}
