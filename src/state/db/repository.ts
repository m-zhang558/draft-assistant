/**
 * Every query the app makes, written against `SqlExecutor` — which is what makes it testable
 * without a browser (`docs/plans/phase-4-plan.md` §1.1). `worker.ts` does nothing but bootstrap
 * the real engine and hand it to `createRepository`; no SQL text lives outside this file and
 * `schema.ts`.
 *
 * `loadAll` is the app's only read path (plan §4 rule 2: "reads never touch the database after
 * boot") — it returns everything in one call, validating every row on the way out exactly as
 * `state/persistence.ts` validates a `localStorage` read: a `format` that is not a known
 * `Format`, a non-finite `sort_order`, a `drafted`/`watched`/`tier_break` outside `{0, 1}` all
 * throw `DatabaseError` naming the board and column. No silent recovery — this is the user's
 * accumulated draft board, and a half-valid read is worse than a loud failure.
 *
 * `applyCommand` is an exhaustive `switch` over `DbCommand`'s `kind`; the `default` branch
 * assigns to a `never`-typed binding, so adding a command to `commands.ts` without handling it
 * here is a compile error, not a runtime gap.
 */
import { isFormat, type BoardMeta, type Format } from '@/domain';
import type { BoardPlayerRow, DbCommand } from './commands';
import { DatabaseError, type SqlExecutor, type SqlRow } from './sql-executor';

export interface PersistedBoardRow {
  playerId: string;
  sortOrder: number;
  drafted: boolean;
  watched: boolean;
  tierBreak: boolean;
  note: string | null;
}

export interface PersistedBoardRecord {
  id: string;
  name: string;
  format: Format;
  createdAt: string;
  rows: PersistedBoardRow[];
}

export interface PersistedDatabase {
  boards: PersistedBoardRecord[];
  settings: Record<string, string>;
}

export interface Repository {
  /** Returns every board (with its rows) and every setting in one call. */
  loadAll(): PersistedDatabase;
  applyCommand(command: DbCommand): void;
  /** True once at least one `board` row exists — distinguishes a fresh database (needs seeding)
   * from a returning one. */
  hasBoards(): boolean;
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (value instanceof Uint8Array) return 'Uint8Array';
  return typeof value;
}

function parseBoardMeta(row: SqlRow): {
  id: string;
  name: string;
  format: Format;
  createdAt: string;
} {
  const { id, name, format } = row;
  const createdAt = row.created_at;

  if (typeof id !== 'string') {
    throw new DatabaseError(`board.id must be a string, got ${describeType(id)}.`);
  }
  if (typeof name !== 'string') {
    throw new DatabaseError(`board(${id}).name must be a string, got ${describeType(name)}.`);
  }
  if (!isFormat(format)) {
    throw new DatabaseError(
      `board(${id}).format is not a known Format, got ${JSON.stringify(format)}.`
    );
  }
  if (typeof createdAt !== 'string') {
    throw new DatabaseError(
      `board(${id}).created_at must be a string, got ${describeType(createdAt)}.`
    );
  }

  return { id, name, format, createdAt };
}

function parseBooleanColumn(
  value: string | number | Uint8Array | null | undefined,
  boardId: string,
  playerId: string,
  column: string
): boolean {
  if (value === 0) return false;
  if (value === 1) return true;
  throw new DatabaseError(
    `board(${boardId}).board_player(${playerId}).${column} must be 0 or 1, got ${describeType(value)}.`
  );
}

function parseBoardPlayerRow(row: SqlRow, boardId: string): PersistedBoardRow {
  const playerId = row.player_id;
  if (typeof playerId !== 'string') {
    throw new DatabaseError(
      `board(${boardId}).board_player.player_id must be a string, got ${describeType(playerId)}.`
    );
  }

  const sortOrder = row.sort_order;
  if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
    throw new DatabaseError(
      `board(${boardId}).board_player(${playerId}).sort_order must be a finite number, got ` +
        `${describeType(sortOrder)}.`
    );
  }

  const drafted = parseBooleanColumn(row.drafted, boardId, playerId, 'drafted');
  const watched = parseBooleanColumn(row.watched, boardId, playerId, 'watched');
  const tierBreak = parseBooleanColumn(row.tier_break, boardId, playerId, 'tier_break');

  const note = row.note;
  if (note !== null && typeof note !== 'string') {
    throw new DatabaseError(
      `board(${boardId}).board_player(${playerId}).note must be a string or null, got ` +
        `${describeType(note)}.`
    );
  }

  return { playerId, sortOrder, drafted, watched, tierBreak, note };
}

export function createRepository(executor: SqlExecutor): Repository {
  function insertBoardPlayerRow(boardId: string, row: BoardPlayerRow): void {
    executor.run(
      'INSERT INTO board_player (board_id, player_id, sort_order, drafted, watched, tier_break, note) ' +
        'VALUES (?, ?, ?, ?, ?, ?, ?)',
      [
        boardId,
        row.playerId,
        row.sortOrder,
        row.drafted ? 1 : 0,
        row.watched ? 1 : 0,
        row.tierBreak ? 1 : 0,
        row.note,
      ]
    );
  }

  function insertBoard(board: BoardMeta): void {
    executor.run('INSERT INTO board (id, name, format, created_at) VALUES (?, ?, ?, ?)', [
      board.id,
      board.name,
      board.format,
      board.createdAt,
    ]);
  }

  function loadAll(): PersistedDatabase {
    const boardRows = executor.all(
      'SELECT id, name, format, created_at FROM board ORDER BY created_at, id'
    );

    const boards: PersistedBoardRecord[] = boardRows.map((boardRow) => {
      const meta = parseBoardMeta(boardRow);
      const playerRows = executor.all(
        'SELECT player_id, sort_order, drafted, watched, tier_break, note FROM board_player ' +
          'WHERE board_id = ? ORDER BY sort_order, player_id',
        [meta.id]
      );
      return {
        ...meta,
        rows: playerRows.map((playerRow) => parseBoardPlayerRow(playerRow, meta.id)),
      };
    });

    const settingRows = executor.all('SELECT key, value FROM app_setting');
    const settings: Record<string, string> = {};
    for (const row of settingRows) {
      const key = row.key;
      const value = row.value;
      if (typeof key !== 'string') {
        throw new DatabaseError(`app_setting.key must be a string, got ${describeType(key)}.`);
      }
      if (typeof value !== 'string') {
        throw new DatabaseError(
          `app_setting(${key}).value must be a string, got ${describeType(value)}.`
        );
      }
      settings[key] = value;
    }

    return { boards, settings };
  }

  function hasBoards(): boolean {
    return executor.all('SELECT 1 AS present FROM board LIMIT 1').length > 0;
  }

  function applyCommand(command: DbCommand): void {
    switch (command.kind) {
      case 'setDrafted':
        executor.run('UPDATE board_player SET drafted = ? WHERE board_id = ? AND player_id = ?', [
          command.drafted ? 1 : 0,
          command.boardId,
          command.playerId,
        ]);
        return;

      case 'setWatched':
        executor.run('UPDATE board_player SET watched = ? WHERE board_id = ? AND player_id = ?', [
          command.watched ? 1 : 0,
          command.boardId,
          command.playerId,
        ]);
        return;

      case 'setTierBreak':
        executor.run(
          'UPDATE board_player SET tier_break = ? WHERE board_id = ? AND player_id = ?',
          [command.tierBreak ? 1 : 0, command.boardId, command.playerId]
        );
        return;

      case 'setNote':
        executor.run('UPDATE board_player SET note = ? WHERE board_id = ? AND player_id = ?', [
          command.note,
          command.boardId,
          command.playerId,
        ]);
        return;

      case 'moveSortKey':
        executor.run(
          'UPDATE board_player SET sort_order = ? WHERE board_id = ? AND player_id = ?',
          [command.sortOrder, command.boardId, command.playerId]
        );
        return;

      case 'renormaliseOrder':
        executor.transaction(() => {
          for (const [playerId, sortOrder] of command.keys) {
            executor.run(
              'UPDATE board_player SET sort_order = ? WHERE board_id = ? AND player_id = ?',
              [sortOrder, command.boardId, playerId]
            );
          }
        });
        return;

      case 'replaceBoardRows':
        executor.transaction(() => {
          executor.run('DELETE FROM board_player WHERE board_id = ?', [command.boardId]);
          for (const row of command.rows) {
            insertBoardPlayerRow(command.boardId, row);
          }
        });
        return;

      case 'createBoard':
        executor.transaction(() => {
          insertBoard(command.board);
          for (const row of command.rows) {
            insertBoardPlayerRow(command.board.id, row);
          }
        });
        return;

      case 'renameBoard':
        executor.run('UPDATE board SET name = ? WHERE id = ?', [command.name, command.boardId]);
        return;

      case 'deleteBoard':
        // board_player rows are removed by ON DELETE CASCADE (schema.ts) — the point of storing
        // this relationship as a real foreign key rather than deleting both tables here.
        executor.run('DELETE FROM board WHERE id = ?', [command.boardId]);
        return;

      case 'setSetting':
        executor.run(
          'INSERT INTO app_setting (key, value) VALUES (?, ?) ' +
            'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
          [command.key, command.value]
        );
        return;

      case 'deleteSetting':
        executor.run('DELETE FROM app_setting WHERE key = ?', [command.key]);
        return;

      default: {
        const exhaustiveCheck: never = command;
        throw new DatabaseError(`Unhandled DbCommand kind: ${JSON.stringify(exhaustiveCheck)}`);
      }
    }
  }

  return { loadAll, applyCommand, hasBoards };
}
