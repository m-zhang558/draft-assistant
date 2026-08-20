/**
 * Board switcher (MVP 4.6): selects which board is active. Boards are user-created and
 * unbounded in count — 4.6 lets you create, duplicate, and rename as many as you like — so this
 * renders a native `<select>` rather than `ToggleGroup` (used for the fixed, 2-entry format
 * switch it replaces): a segmented control reads fine for two or three options but wraps badly
 * and eats header width past ~4-5 entries, while a `<select>` stays one compact control and one
 * DOM node no matter how many boards exist, with keyboard/screen-reader support for free.
 *
 * Each option's label is the board's own name; its format is appended as a bracketed secondary
 * label, since 4.6 allows more than one board of the same format (`duplicateBoard`) and format
 * alone would no longer disambiguate them.
 *
 * Self-sufficient: reads and writes `activeBoardId` on the board store directly, like
 * `format-switch.tsx` did — `App` stays a pure layout shell.
 */
import type { ChangeEvent } from 'react';
import { useBoardStore } from '@/state';
import { FORMAT_LABELS } from './format-labels';

export function BoardSwitch() {
  const boardIds = useBoardStore((state) => state.boardIds);
  const boards = useBoardStore((state) => state.boards);
  const activeBoardId = useBoardStore((state) => state.activeBoardId);

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    useBoardStore.getState().setActiveBoard(event.target.value);
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="board-switch" className="text-sm font-medium text-text-primary">
        Board
      </label>
      <select
        id="board-switch"
        value={activeBoardId}
        onChange={handleChange}
        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {boardIds.map((id) => {
          const board = boards[id];
          if (!board) {
            return null;
          }
          return (
            <option key={id} value={id}>
              {board.name} ({FORMAT_LABELS[board.format]})
            </option>
          );
        })}
      </select>
    </div>
  );
}
