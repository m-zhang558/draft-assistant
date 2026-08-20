import { migrate } from './schema';
import { createRepository, type Repository } from './repository';
import { createTestSqlExecutor } from './sql-executor.test-support';
import { handleRequest, type DbRequest } from './protocol';

function createTestRepository(): Repository {
  const executor = createTestSqlExecutor();
  migrate(executor);
  return createRepository(executor);
}

describe('handleRequest', () => {
  it('"open" is a no-op readiness handshake', () => {
    const repository = createTestRepository();
    expect(handleRequest(repository, { id: 1, kind: 'open' })).toBeUndefined();
  });

  it('"load" returns the repository\'s loadAll() result', () => {
    const repository = createTestRepository();
    repository.applyCommand({
      kind: 'createBoard',
      board: { id: 'b1', name: 'Board', format: 'redraft-ppr', createdAt: '2026-01-01' },
      rows: [],
    });

    const result = handleRequest(repository, { id: 2, kind: 'load' });
    expect(result).toEqual(repository.loadAll());
  });

  it('"command" applies exactly one command', () => {
    const repository = createTestRepository();
    repository.applyCommand({
      kind: 'createBoard',
      board: { id: 'b1', name: 'Board', format: 'redraft-ppr', createdAt: '2026-01-01' },
      rows: [
        {
          playerId: 'p1',
          sortOrder: 1,
          drafted: false,
          watched: false,
          tierBreak: false,
          note: null,
        },
      ],
    });

    handleRequest(repository, {
      id: 3,
      kind: 'command',
      command: { kind: 'setDrafted', boardId: 'b1', playerId: 'p1', drafted: true },
    });

    expect(repository.loadAll().boards[0]?.rows[0]?.drafted).toBe(true);
  });

  it('"commands" applies every command in order', () => {
    const repository = createTestRepository();
    repository.applyCommand({
      kind: 'createBoard',
      board: { id: 'b1', name: 'Board', format: 'redraft-ppr', createdAt: '2026-01-01' },
      rows: [
        {
          playerId: 'p1',
          sortOrder: 1,
          drafted: false,
          watched: false,
          tierBreak: false,
          note: null,
        },
      ],
    });

    handleRequest(repository, {
      id: 4,
      kind: 'commands',
      commands: [
        { kind: 'setDrafted', boardId: 'b1', playerId: 'p1', drafted: true },
        { kind: 'setWatched', boardId: 'b1', playerId: 'p1', watched: true },
      ],
    });

    const row = repository.loadAll().boards[0]?.rows[0];
    expect(row?.drafted).toBe(true);
    expect(row?.watched).toBe(true);
  });

  it('throws for "export" — it needs the raw sqlite3 handle, which only worker.ts holds', () => {
    const repository = createTestRepository();
    expect(() => handleRequest(repository, { id: 5, kind: 'export' })).toThrow(
      /needs the raw sqlite3 handle/
    );
  });

  it('throws for "import" for the same reason', () => {
    const repository = createTestRepository();
    expect(() =>
      handleRequest(repository, { id: 6, kind: 'import', bytes: new Uint8Array() })
    ).toThrow(/needs the raw sqlite3 handle/);
  });

  it('throws on an unrecognised request kind rather than silently doing nothing', () => {
    const repository = createTestRepository();
    const bogus = { id: 7, kind: 'not-a-real-kind' } as unknown as DbRequest;
    expect(() => handleRequest(repository, bogus)).toThrow(/Unhandled DbRequest kind/);
  });
});
