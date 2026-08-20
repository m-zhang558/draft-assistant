/**
 * Forward-only migrations, applied as data rather than as a chain of `if`s (`PROJECT.md` §5's
 * `schemaVersion` pattern, transplanted from `localStorage` to SQLite). This `schema_version` is
 * the SQLite schema's own version — independent of, and unrelated to, `persistence.ts`'s
 * `STORAGE_SCHEMA_VERSION`, which stays frozen at 2 (`docs/plans/phase-4-plan.md` §3.1).
 *
 * `migrate` is the only place that writes DDL. It:
 * - sets `PRAGMA foreign_keys = ON` and verifies it actually took effect — SQLite defaults it
 *   off, and `board_player`'s `ON DELETE CASCADE` is silently inert without it;
 * - treats a database with no `schema_version` table as version 0;
 * - applies only the migrations above the current version, each in its own transaction;
 * - refuses to open a database whose stored version is higher than `SCHEMA_VERSION` — that means
 *   a newer build of the app wrote this file, and there is no rule for reading it backwards.
 */
import { DatabaseError, type SqlExecutor } from './sql-executor';

export const SCHEMA_VERSION = 1;

interface Migration {
  readonly version: number;
  readonly statements: readonly string[];
}

const MIGRATION_V1: Migration = {
  version: 1,
  statements: [
    'CREATE TABLE schema_version (version INTEGER NOT NULL)',
    `CREATE TABLE board (
      id         TEXT    PRIMARY KEY,
      name       TEXT    NOT NULL,
      format     TEXT    NOT NULL CHECK (format IN ('redraft-ppr', 'dynasty-sf')),
      created_at TEXT    NOT NULL
    )`,
    `CREATE TABLE board_player (
      board_id   TEXT    NOT NULL REFERENCES board(id) ON DELETE CASCADE,
      player_id  TEXT    NOT NULL,
      sort_order REAL    NOT NULL,
      drafted    INTEGER NOT NULL DEFAULT 0 CHECK (drafted IN (0, 1)),
      watched    INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
      tier_break INTEGER NOT NULL DEFAULT 0 CHECK (tier_break IN (0, 1)),
      note       TEXT,
      PRIMARY KEY (board_id, player_id)
    )`,
    'CREATE INDEX board_player_order ON board_player (board_id, sort_order)',
    'CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  ],
};

/** Every migration, in ascending version order. Version 0 (a brand-new database) is implicit —
 * there is no `Migration` for it. */
export const MIGRATIONS: readonly Migration[] = [MIGRATION_V1];

function schemaVersionTableExists(executor: SqlExecutor): boolean {
  const rows = executor.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_version'`
  );
  return rows.length > 0;
}

/** Reads the database's current schema version. A database with no `schema_version` table, or
 * one with the table but no row in it, is version 0 — both describe a fresh or pre-migration
 * database, not an error. */
export function readSchemaVersion(executor: SqlExecutor): number {
  if (!schemaVersionTableExists(executor)) {
    return 0;
  }

  const rows = executor.all('SELECT version FROM schema_version LIMIT 1');
  const row = rows[0];
  if (!row) {
    return 0;
  }

  const version = row.version;
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new DatabaseError(
      `schema_version.version must be a finite number, got ${JSON.stringify(version)}.`
    );
  }
  return version;
}

function assertForeignKeysEnforced(executor: SqlExecutor): void {
  executor.run('PRAGMA foreign_keys = ON');
  const rows = executor.all('PRAGMA foreign_keys');
  const row = rows[0];
  const value = row ? row.foreign_keys : undefined;
  if (value !== 1) {
    throw new DatabaseError(
      `PRAGMA foreign_keys did not take effect (read back ${JSON.stringify(value)} instead of 1). ` +
        'board_player.ON DELETE CASCADE would be silently inert — refusing to proceed.'
    );
  }
}

/**
 * Brings `executor`'s database up to `SCHEMA_VERSION`. Idempotent: calling it again on an
 * already-current database applies no migrations. Throws `DatabaseError` if the stored version is
 * newer than this build supports, or if `PRAGMA foreign_keys` cannot be verified as enabled.
 */
export function migrate(executor: SqlExecutor): void {
  assertForeignKeysEnforced(executor);

  const currentVersion = readSchemaVersion(executor);
  if (currentVersion > SCHEMA_VERSION) {
    throw new DatabaseError(
      `Database schema_version (${currentVersion}) is newer than this build supports ` +
        `(${SCHEMA_VERSION}). This file was written by a newer version of the app — refusing to ` +
        'open it, since there is no rule for reading a schema backwards.'
    );
  }

  const pending = MIGRATIONS.filter((migration) => migration.version > currentVersion).sort(
    (a, b) => a.version - b.version
  );

  for (const migration of pending) {
    executor.transaction(() => {
      for (const statement of migration.statements) {
        executor.run(statement);
      }
      executor.run('DELETE FROM schema_version');
      executor.run('INSERT INTO schema_version (version) VALUES (?)', [migration.version]);
    });
  }
}
