/**
 * Board management (MVP 4.6): create, rename, duplicate, and delete boards. `board-switch.tsx`'s
 * `<select>` already handles simply switching between existing boards; this is the CRUD surface
 * beside it, tucked behind a "Manage boards" toggle rather than laid out inline — the header
 * must stay usable at 375px (PROJECT.md §3.5), and four forms' worth of controls do not fit
 * there permanently. The panel is a `position: absolute` dropdown anchored under the toggle
 * button, not a document-flow expansion: the header sits above the virtualised board (which owns
 * its own scroll region, PROJECT.md §8), so growing the header in flow would visibly resize the
 * board every time the panel opens — the overlay avoids that entirely.
 *
 * Format is fixed at creation (`board-store.ts`'s `createBoard` — a board's order is over a
 * different player set once created), so the create form is the only place a `Format` is ever
 * chosen. The default name follows the format's label (`FORMAT_LABELS`), de-duplicated against
 * every existing board name via `domain/boards.ts` `nextBoardName`.
 *
 * Rename (and, defensively, create) validates through `domain/boards.ts` `validateBoardName`
 * BEFORE calling the store and shows the error inline: the store's own `renameBoard`/
 * `createBoard` still validate and would throw on a bug in this pre-validation, but letting that
 * throw reach the UI directly would be an uncaught render-time crash, not a form error a user
 * can read and fix.
 *
 * Delete goes through `ConfirmButton`'s two-step confirm (never `window.confirm`, MVP 2.10).
 * `deleteBoard` itself refuses to delete the last remaining board — rather than let a click throw
 * unexpectedly, the control is DISABLED whenever only one board remains, with `title`/
 * `aria-description` naming why, so the refusal is legible before the click rather than after it.
 *
 * Every action (create/rename/duplicate/delete) announces through `LiveRegion`: a board list
 * changing is exactly the off-screen state change PROJECT.md §6 requires announcing.
 */
import { useState, type ChangeEvent, type FormEvent } from 'react';
import { FORMATS, nextBoardName, validateBoardName, type Format } from '@/domain';
import { useBoardStore, type BoardSlice } from '@/state';
import { Button, ConfirmButton, LiveRegion } from '@/ui';
import { FORMAT_LABELS } from './format-labels';

function defaultNameFor(
  format: Format,
  boards: Record<string, BoardSlice>,
  boardIds: readonly string[]
): string {
  const existingNames = boardIds
    .map((id) => boards[id]?.name)
    .filter((name): name is string => name !== undefined);
  return nextBoardName(existingNames, FORMAT_LABELS[format]);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function BoardManager() {
  const boardIds = useBoardStore((state) => state.boardIds);
  const boards = useBoardStore((state) => state.boards);
  const activeBoardId = useBoardStore((state) => state.activeBoardId);
  const activeBoardSlice = boards[activeBoardId];
  const activeBoardName = activeBoardSlice?.name ?? '';

  const [open, setOpen] = useState(false);
  const [createFormat, setCreateFormat] = useState<Format>('redraft-ppr');
  const [createName, setCreateName] = useState(() =>
    defaultNameFor('redraft-ppr', boards, boardIds)
  );
  const [createError, setCreateError] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState(activeBoardName);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

  function handleToggle() {
    if (!open) {
      // Reset both forms to fresh defaults every time the panel opens, rather than leaving
      // stale text from a previous open (or a previous active board) sitting in them.
      setCreateFormat('redraft-ppr');
      setCreateName(defaultNameFor('redraft-ppr', boards, boardIds));
      setCreateError(null);
      setRenameValue(activeBoardName);
      setRenameError(null);
    }
    setOpen(!open);
  }

  function handleFormatChange(event: ChangeEvent<HTMLSelectElement>) {
    const format = event.target.value as Format;
    setCreateFormat(format);
    setCreateName(defaultNameFor(format, boards, boardIds));
    setCreateError(null);
  }

  function handleCreate(event: FormEvent) {
    event.preventDefault();
    try {
      const validName = validateBoardName(createName);
      useBoardStore.getState().createBoard(validName, createFormat);
      setCreateError(null);
      setAnnouncement(`Created board "${validName}".`);
      const state = useBoardStore.getState();
      setCreateName(defaultNameFor(createFormat, state.boards, state.boardIds));
    } catch (error) {
      setCreateError(describeError(error));
    }
  }

  function handleRename(event: FormEvent) {
    event.preventDefault();
    try {
      const validName = validateBoardName(renameValue);
      useBoardStore.getState().renameBoard(activeBoardId, validName);
      setRenameError(null);
      setRenameValue(validName);
      setAnnouncement(`Renamed board to "${validName}".`);
    } catch (error) {
      setRenameError(describeError(error));
    }
  }

  function handleDuplicate() {
    const sourceName = activeBoardName || 'board';
    try {
      useBoardStore.getState().duplicateBoard(activeBoardId);
      const state = useBoardStore.getState();
      const newName = state.boards[state.activeBoardId]?.name ?? sourceName;
      setAnnouncement(`Duplicated "${sourceName}" as "${newName}".`);
    } catch (error) {
      setAnnouncement(`Could not duplicate board: ${describeError(error)}`);
    }
  }

  function handleDelete() {
    const name = activeBoardName || 'board';
    try {
      useBoardStore.getState().deleteBoard(activeBoardId);
      setAnnouncement(`Deleted board "${name}".`);
    } catch (error) {
      setAnnouncement(`Could not delete board: ${describeError(error)}`);
    }
  }

  const canDelete = boardIds.length > 1;

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleToggle}
        aria-expanded={open}
        aria-controls="board-manager-panel"
      >
        Manage boards
      </Button>
      {open ? (
        <div
          id="board-manager-panel"
          className="absolute right-0 top-full z-30 mt-2 w-72 max-w-[90vw] rounded-md border border-border bg-surface p-3 shadow-lg"
        >
          <form
            onSubmit={handleCreate}
            className="mb-3 flex flex-col gap-1.5 border-b border-border pb-3"
          >
            <span className="text-xs font-semibold text-text-primary">Create board</span>
            <label htmlFor="board-manager-format" className="text-xs text-text-muted">
              Format
            </label>
            <select
              id="board-manager-format"
              value={createFormat}
              onChange={handleFormatChange}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            >
              {FORMATS.map((format) => (
                <option key={format} value={format}>
                  {FORMAT_LABELS[format]}
                </option>
              ))}
            </select>
            <label htmlFor="board-manager-create-name" className="text-xs text-text-muted">
              Name
            </label>
            <input
              id="board-manager-create-name"
              type="text"
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            />
            {createError ? <p className="text-xs text-danger">{createError}</p> : null}
            <Button type="submit" variant="primary" size="sm">
              Create
            </Button>
          </form>

          <form
            onSubmit={handleRename}
            className="mb-3 flex flex-col gap-1.5 border-b border-border pb-3"
          >
            <span className="text-xs font-semibold text-text-primary">Rename current board</span>
            <label htmlFor="board-manager-rename-name" className="sr-only">
              New name for {activeBoardName || 'the current board'}
            </label>
            <input
              id="board-manager-rename-name"
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-text-primary"
            />
            {renameError ? <p className="text-xs text-danger">{renameError}</p> : null}
            <Button type="submit" variant="secondary" size="sm">
              Rename
            </Button>
          </form>

          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={handleDuplicate}>
              Duplicate
            </Button>
            {canDelete ? (
              <ConfirmButton
                label="Delete board"
                confirmLabel="Confirm delete?"
                onConfirm={handleDelete}
                variant="danger"
                size="sm"
              />
            ) : (
              <Button
                variant="danger"
                size="sm"
                disabled
                title="At least one board must remain — create another board before deleting this one."
                aria-description="Delete is disabled because at least one board must remain."
              >
                Delete board
              </Button>
            )}
          </div>
        </div>
      ) : null}
      <LiveRegion message={announcement} label="Board management status" />
    </div>
  );
}
