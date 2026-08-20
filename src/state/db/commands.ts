/**
 * The write side of `db/`: every mutation the app can make, as a discriminated union
 * (`docs/plans/phase-4-plan.md` §4.1). The worker takes this union rather than raw SQL, so SQL
 * text never crosses the `postMessage` boundary (`protocol.ts`) — only `repository.ts`'s
 * `applyCommand` ever turns a `DbCommand` into a statement.
 *
 * Each row-level command is one `UPDATE`; `renormaliseOrder`, `replaceBoardRows`, and
 * `createBoard` each run inside a single transaction (`repository.ts`). `deleteBoard` relies on
 * `board_player`'s `ON DELETE CASCADE` (`schema.ts`) rather than deleting rows itself.
 */
import type { BoardMeta } from '@/domain';

/** One `board_player` row, shared by every command that writes a full row (as opposed to a
 * single column). Field names are camelCase; `repository.ts` maps them to `snake_case` columns. */
export interface BoardPlayerRow {
  readonly playerId: string;
  readonly sortOrder: number;
  readonly drafted: boolean;
  readonly watched: boolean;
  readonly tierBreak: boolean;
  readonly note: string | null;
}

export interface SetDraftedCommand {
  readonly kind: 'setDrafted';
  readonly boardId: string;
  readonly playerId: string;
  readonly drafted: boolean;
}

export interface SetWatchedCommand {
  readonly kind: 'setWatched';
  readonly boardId: string;
  readonly playerId: string;
  readonly watched: boolean;
}

export interface SetTierBreakCommand {
  readonly kind: 'setTierBreak';
  readonly boardId: string;
  readonly playerId: string;
  readonly tierBreak: boolean;
}

export interface SetNoteCommand {
  readonly kind: 'setNote';
  readonly boardId: string;
  readonly playerId: string;
  readonly note: string | null;
}

/** A drag or Alt+↑/↓: one player's `sort_order` moves to a new fractional key. Exactly one
 * `UPDATE` — the whole justification for `sort_order` being `REAL` (plan §3.2). */
export interface MoveSortKeyCommand {
  readonly kind: 'moveSortKey';
  readonly boardId: string;
  readonly playerId: string;
  readonly sortOrder: number;
}

/** Rewrites every row's `sort_order` to evenly spaced values, in one transaction. Raised when
 * `domain/fractional-order.ts`'s `needsRenormalisation` trips — rare, off the interaction path. */
export interface RenormaliseOrderCommand {
  readonly kind: 'renormaliseOrder';
  readonly boardId: string;
  readonly keys: ReadonlyArray<readonly [playerId: string, sortOrder: number]>;
}

/** Replaces a board's entire row set: DELETE then bulk INSERT, in one transaction. Used by
 * undo/redo, reset-to-expert, and JSON import — anywhere the whole board is restored at once
 * rather than one field changing. */
export interface ReplaceBoardRowsCommand {
  readonly kind: 'replaceBoardRows';
  readonly boardId: string;
  readonly rows: readonly BoardPlayerRow[];
}

/** Inserts a new `board` row and its initial `board_player` rows, in one transaction. */
export interface CreateBoardCommand {
  readonly kind: 'createBoard';
  readonly board: BoardMeta;
  readonly rows: readonly BoardPlayerRow[];
}

export interface RenameBoardCommand {
  readonly kind: 'renameBoard';
  readonly boardId: string;
  readonly name: string;
}

/** Deletes a `board` row; `board_player`'s `ON DELETE CASCADE` (schema.ts) removes its rows. */
export interface DeleteBoardCommand {
  readonly kind: 'deleteBoard';
  readonly boardId: string;
}

export interface SetSettingCommand {
  readonly kind: 'setSetting';
  readonly key: string;
  readonly value: string;
}

export interface DeleteSettingCommand {
  readonly kind: 'deleteSetting';
  readonly key: string;
}

export type DbCommand =
  | SetDraftedCommand
  | SetWatchedCommand
  | SetTierBreakCommand
  | SetNoteCommand
  | MoveSortKeyCommand
  | RenormaliseOrderCommand
  | ReplaceBoardRowsCommand
  | CreateBoardCommand
  | RenameBoardCommand
  | DeleteBoardCommand
  | SetSettingCommand
  | DeleteSettingCommand;
