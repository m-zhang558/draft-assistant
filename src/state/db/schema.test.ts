import { DatabaseError } from './sql-executor';
import { createTestSqlExecutor } from './sql-executor.test-support';
import { MIGRATIONS, SCHEMA_VERSION, migrate, readSchemaVersion } from './schema';

describe('readSchemaVersion', () => {
  it('is 0 for a brand-new database with no schema_version table', () => {
    const executor = createTestSqlExecutor();
    expect(readSchemaVersion(executor)).toBe(0);
  });
});

describe('migrate', () => {
  it('brings a fresh database to SCHEMA_VERSION and creates every v1 table', () => {
    const executor = createTestSqlExecutor();
    migrate(executor);

    expect(readSchemaVersion(executor)).toBe(SCHEMA_VERSION);

    const tables = executor
      .all(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
      .map((row) => row.name);
    expect(tables).toEqual(['app_setting', 'board', 'board_player', 'schema_version']);
  });

  it('is a no-op when run a second time on an already-current database', () => {
    const executor = createTestSqlExecutor();
    migrate(executor);
    migrate(executor);
    expect(readSchemaVersion(executor)).toBe(SCHEMA_VERSION);
  });

  it('sets PRAGMA foreign_keys = ON', () => {
    const executor = createTestSqlExecutor();
    migrate(executor);
    const rows = executor.all('PRAGMA foreign_keys');
    expect(rows[0]?.foreign_keys).toBe(1);
  });

  it('throws DatabaseError when the stored version is newer than SCHEMA_VERSION', () => {
    const executor = createTestSqlExecutor();
    migrate(executor);
    executor.run('DELETE FROM schema_version');
    executor.run('INSERT INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION + 1]);

    expect(() => migrate(executor)).toThrow(DatabaseError);
    expect(() => migrate(executor)).toThrow(/newer than this build supports/);
  });

  it('applies every migration in MIGRATIONS in a single call each, in ascending order', () => {
    // Documents the invariant applyCommand-adjacent code relies on: MIGRATIONS is sorted and
    // covers every version up to SCHEMA_VERSION with no gaps.
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(versions[versions.length - 1]).toBe(SCHEMA_VERSION);
  });
});
