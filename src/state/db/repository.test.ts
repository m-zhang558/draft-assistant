import { migrate } from './schema';
import { createRepository, type Repository } from './repository';
import { DatabaseError, type SqlExecutor } from './sql-executor';
import { createTestSqlExecutor } from './sql-executor.test-support';
import type { BoardPlayerRow } from './commands';

function row(
  overrides: Partial<BoardPlayerRow> & { playerId: string; sortOrder: number }
): BoardPlayerRow {
  return {
    drafted: false,
    watched: false,
    tierBreak: false,
    note: null,
    ...overrides,
  };
}

function setUp(): { executor: SqlExecutor; repository: Repository } {
  const executor = createTestSqlExecutor();
  migrate(executor);
  return { executor, repository: createRepository(executor) };
}

const BOARD_META = {
  id: 'board-1',
  name: 'Redraft PPR',
  format: 'redraft-ppr' as const,
  createdAt: '2026-01-01T00:00:00.000Z',
};

describe('hasBoards', () => {
  it('is false for a freshly migrated database and true once a board exists', () => {
    const { repository } = setUp();
    expect(repository.hasBoards()).toBe(false);

    repository.applyCommand({ kind: 'createBoard', board: BOARD_META, rows: [] });
    expect(repository.hasBoards()).toBe(true);
  });
});

describe('createBoard / loadAll round trip', () => {
  it('returns the board and its rows exactly as created, ordered by sort_order then player_id', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [
        row({ playerId: 'p3', sortOrder: 3 }),
        row({ playerId: 'p1', sortOrder: 1 }),
        row({ playerId: 'p2', sortOrder: 2 }),
      ],
    });

    const db = repository.loadAll();
    expect(db.boards).toHaveLength(1);
    const board = db.boards[0]!;
    expect(board).toMatchObject(BOARD_META);
    expect(board.rows.map((r) => r.playerId)).toEqual(['p1', 'p2', 'p3']);
  });

  it('orders multiple boards by created_at then id', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: { id: 'b-later', name: 'Later', format: 'redraft-ppr', createdAt: '2026-02-01' },
      rows: [],
    });
    repository.applyCommand({
      kind: 'createBoard',
      board: { id: 'b-earlier', name: 'Earlier', format: 'dynasty-sf', createdAt: '2026-01-01' },
      rows: [],
    });

    const db = repository.loadAll();
    expect(db.boards.map((b) => b.id)).toEqual(['b-earlier', 'b-later']);
  });
});

describe('applyCommand: every kind round-trips through loadAll', () => {
  it('setDrafted', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });
    repository.applyCommand({
      kind: 'setDrafted',
      boardId: BOARD_META.id,
      playerId: 'p1',
      drafted: true,
    });
    expect(repository.loadAll().boards[0]?.rows[0]?.drafted).toBe(true);
  });

  it('setWatched', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });
    repository.applyCommand({
      kind: 'setWatched',
      boardId: BOARD_META.id,
      playerId: 'p1',
      watched: true,
    });
    expect(repository.loadAll().boards[0]?.rows[0]?.watched).toBe(true);
  });

  it('setTierBreak', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });
    repository.applyCommand({
      kind: 'setTierBreak',
      boardId: BOARD_META.id,
      playerId: 'p1',
      tierBreak: true,
    });
    expect(repository.loadAll().boards[0]?.rows[0]?.tierBreak).toBe(true);
  });

  it('setNote, including clearing a note back to null', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });
    repository.applyCommand({
      kind: 'setNote',
      boardId: BOARD_META.id,
      playerId: 'p1',
      note: 'sleeper pick',
    });
    expect(repository.loadAll().boards[0]?.rows[0]?.note).toBe('sleeper pick');

    repository.applyCommand({
      kind: 'setNote',
      boardId: BOARD_META.id,
      playerId: 'p1',
      note: null,
    });
    expect(repository.loadAll().boards[0]?.rows[0]?.note).toBeNull();
  });

  it('moveSortKey', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });
    repository.applyCommand({
      kind: 'moveSortKey',
      boardId: BOARD_META.id,
      playerId: 'p1',
      sortOrder: 42.5,
    });
    expect(repository.loadAll().boards[0]?.rows[0]?.sortOrder).toBe(42.5);
  });

  it('renormaliseOrder', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [
        row({ playerId: 'p1', sortOrder: 1.1 }),
        row({ playerId: 'p2', sortOrder: 1.2 }),
        row({ playerId: 'p3', sortOrder: 1.3 }),
      ],
    });
    repository.applyCommand({
      kind: 'renormaliseOrder',
      boardId: BOARD_META.id,
      keys: [
        ['p1', 1000],
        ['p2', 2000],
        ['p3', 3000],
      ],
    });

    const rows = repository.loadAll().boards[0]?.rows;
    expect(rows?.map((r) => [r.playerId, r.sortOrder])).toEqual([
      ['p1', 1000],
      ['p2', 2000],
      ['p3', 3000],
    ]);
  });

  it('replaceBoardRows', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });
    repository.applyCommand({
      kind: 'replaceBoardRows',
      boardId: BOARD_META.id,
      rows: [
        row({ playerId: 'p9', sortOrder: 9, drafted: true }),
        row({ playerId: 'p8', sortOrder: 8 }),
      ],
    });

    const rows = repository.loadAll().boards[0]?.rows;
    expect(rows?.map((r) => r.playerId)).toEqual(['p8', 'p9']);
    expect(rows?.find((r) => r.playerId === 'p9')?.drafted).toBe(true);
  });

  it('createBoard (its own round trip is covered above, this asserts the meta fields too)', () => {
    const { repository } = setUp();
    repository.applyCommand({ kind: 'createBoard', board: BOARD_META, rows: [] });
    const board = repository.loadAll().boards[0]!;
    expect(board.name).toBe(BOARD_META.name);
    expect(board.format).toBe(BOARD_META.format);
    expect(board.createdAt).toBe(BOARD_META.createdAt);
  });

  it('renameBoard', () => {
    const { repository } = setUp();
    repository.applyCommand({ kind: 'createBoard', board: BOARD_META, rows: [] });
    repository.applyCommand({ kind: 'renameBoard', boardId: BOARD_META.id, name: 'New Name' });
    expect(repository.loadAll().boards[0]?.name).toBe('New Name');
  });

  it('deleteBoard', () => {
    const { repository } = setUp();
    repository.applyCommand({ kind: 'createBoard', board: BOARD_META, rows: [] });
    repository.applyCommand({ kind: 'deleteBoard', boardId: BOARD_META.id });
    expect(repository.loadAll().boards).toHaveLength(0);
  });

  it('setSetting, including overwriting an existing key (upsert)', () => {
    const { repository } = setUp();
    repository.applyCommand({ kind: 'setSetting', key: 'theme', value: 'dark' });
    expect(repository.loadAll().settings.theme).toBe('dark');

    repository.applyCommand({ kind: 'setSetting', key: 'theme', value: 'light' });
    expect(repository.loadAll().settings.theme).toBe('light');
  });

  it('deleteSetting', () => {
    const { repository } = setUp();
    repository.applyCommand({ kind: 'setSetting', key: 'theme', value: 'dark' });
    repository.applyCommand({ kind: 'deleteSetting', key: 'theme' });
    expect(repository.loadAll().settings.theme).toBeUndefined();
  });
});

describe('moveSortKey writes exactly one row', () => {
  it("leaves every other row's sort_order byte-identical", () => {
    const { repository } = setUp();
    const rows = [
      row({ playerId: 'p1', sortOrder: 1 }),
      row({ playerId: 'p2', sortOrder: 2 }),
      row({ playerId: 'p3', sortOrder: 3 }),
      row({ playerId: 'p4', sortOrder: 4 }),
      row({ playerId: 'p5', sortOrder: 5 }),
    ];
    repository.applyCommand({ kind: 'createBoard', board: BOARD_META, rows });

    repository.applyCommand({
      kind: 'moveSortKey',
      boardId: BOARD_META.id,
      playerId: 'p3',
      sortOrder: 1.5,
    });

    const after = repository.loadAll().boards[0]!.rows;
    const byId = new Map(after.map((r) => [r.playerId, r.sortOrder]));
    expect(byId.get('p1')).toBe(1);
    expect(byId.get('p2')).toBe(2);
    expect(byId.get('p3')).toBe(1.5);
    expect(byId.get('p4')).toBe(4);
    expect(byId.get('p5')).toBe(5);
  });
});

describe('replaceBoardRows atomicity', () => {
  it('leaves the previous rows intact when an insert mid-way violates a constraint', () => {
    const { repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'original', sortOrder: 1 })],
    });

    expect(() =>
      repository.applyCommand({
        kind: 'replaceBoardRows',
        boardId: BOARD_META.id,
        rows: [
          row({ playerId: 'new-1', sortOrder: 1 }),
          // Duplicate player_id within the same board -> violates the
          // PRIMARY KEY (board_id, player_id) constraint mid-transaction.
          row({ playerId: 'new-1', sortOrder: 2 }),
        ],
      })
    ).toThrow();

    const rows = repository.loadAll().boards[0]?.rows;
    expect(rows?.map((r) => r.playerId)).toEqual(['original']);
  });
});

describe('deleteBoard cascades', () => {
  it('removes board_player rows for the deleted board via ON DELETE CASCADE', () => {
    const { executor, repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 }), row({ playerId: 'p2', sortOrder: 2 })],
    });

    const before = executor.all('SELECT COUNT(*) AS n FROM board_player WHERE board_id = ?', [
      BOARD_META.id,
    ]);
    expect(before[0]?.n).toBe(2);

    repository.applyCommand({ kind: 'deleteBoard', boardId: BOARD_META.id });

    const after = executor.all('SELECT COUNT(*) AS n FROM board_player WHERE board_id = ?', [
      BOARD_META.id,
    ]);
    expect(after[0]?.n).toBe(0);
  });
});

describe('loadAll validation', () => {
  it('throws DatabaseError naming the board when board.format is corrupt', () => {
    const { executor, repository } = setUp();
    repository.applyCommand({ kind: 'createBoard', board: BOARD_META, rows: [] });

    // The `format` column has a CHECK constraint; bypass it deliberately to prove loadAll's own
    // defensive validation catches the corruption independently of the database constraint.
    executor.run('PRAGMA ignore_check_constraints = ON');
    executor.run('UPDATE board SET format = ? WHERE id = ?', ['nonsense', BOARD_META.id]);

    expect(() => repository.loadAll()).toThrow(DatabaseError);
    expect(() => repository.loadAll()).toThrow(new RegExp(BOARD_META.id));
  });

  it('throws DatabaseError when a board_player.drafted value is outside {0, 1}', () => {
    const { executor, repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });

    executor.run('PRAGMA ignore_check_constraints = ON');
    executor.run('UPDATE board_player SET drafted = 7 WHERE board_id = ? AND player_id = ?', [
      BOARD_META.id,
      'p1',
    ]);

    expect(() => repository.loadAll()).toThrow(DatabaseError);
    expect(() => repository.loadAll()).toThrow(/drafted/);
  });

  it('throws DatabaseError when sort_order is not a finite number', () => {
    const { executor, repository } = setUp();
    repository.applyCommand({
      kind: 'createBoard',
      board: BOARD_META,
      rows: [row({ playerId: 'p1', sortOrder: 1 })],
    });

    executor.run("UPDATE board_player SET sort_order = 'not-a-number' WHERE player_id = 'p1'");

    expect(() => repository.loadAll()).toThrow(DatabaseError);
    expect(() => repository.loadAll()).toThrow(/sort_order/);
  });
});
