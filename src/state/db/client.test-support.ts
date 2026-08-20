/**
 * Test-only `DatabaseClient` that resolves every request immediately against an in-process
 * `Repository`, backed by the REAL SQLite engine from `sql-executor.test-support.ts` — no
 * `Worker`, no `postMessage` boundary (`docs/plans/phase-4-plan.md` §1.1's "tests supply a real
 * SQL engine rather than a mock", extended to the client seam too).
 *
 * `createBoardStore`/`initialiseBoardStore` and every component test that renders the board go
 * through this rather than a mocked `DatabaseClient`, so store and component tests exercise the
 * exact same `schema.ts` migrations and `repository.ts` queries the production worker runs —
 * only the transport (an in-process function call instead of a worker thread) differs.
 *
 * `exportBytes`/`importBytes` (MVP 4.13, Stage E) mirror `worker.ts`'s own export/import,
 * substituting `node:sqlite`'s `backup()` for `sqlite3_js_db_export`/`SAHPoolUtil#importDb`:
 * `exportBytes` backs the live `DatabaseSync` up to a throwaway temp file, reads its bytes, and
 * deletes the directory immediately (nothing further is ever written to that specific file, so
 * POSIX unlinking it out from under the still-open handle used only to read it back is safe).
 * `importBytes` writes the given bytes to a NEW temp file and opens a fresh `DatabaseSync` on it
 * — that file's directory is deliberately kept alive (tracked in `importDir`, swapped out on the
 * next `importBytes` and removed on `close()`) rather than deleted right away: unlike the export
 * file, this one goes on to serve every subsequent write, and SQLite's rollback journal needs to
 * create sibling files (`-journal`) alongside it — deleting the directory a write's siblings live
 * in fails the write, even though the main file's own fd would otherwise survive an unlink fine.
 * Migrating the freshly opened database forward matches `worker.ts`'s `importDatabase` (an
 * imported file may predate this build's schema).
 *
 * Nothing outside a `*.test.ts(x)` file imports this module; like `sql-executor.test-support.ts`
 * it is not reachable from any entry point Vite bundles, and `db/index.ts` deliberately does not
 * re-export it.
 */
import { DatabaseSync, backup } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseClient } from './client';
import type { DbCommand } from './commands';
import { createRepository, type PersistedDatabase, type Repository } from './repository';
import { migrate } from './schema';
import { wrapTestDatabase } from './sql-executor.test-support';
import { DatabaseError } from './sql-executor';

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'fantasy-assist-test-db-'));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A fresh, isolated `DatabaseClient` over its own in-memory SQLite database. Every call
 * resolves in the same microtask turn it was made (there is no worker round trip), so tests do
 * not need to fake timers or a message loop — `await`ing the returned promise is enough. */
export function createTestDatabaseClient(): DatabaseClient {
  let db = new DatabaseSync(':memory:');
  let repository: Repository = createRepository(wrapTestDatabase(db));
  let migrated = false;
  let closed = false;
  /** The temp directory backing the currently-open `db`, when it was opened by `importBytes`
   * rather than the initial `:memory:` database — see the file header for why it outlives the
   * call that created it. */
  let importDir: string | null = null;

  function replaceImportDir(): string {
    if (importDir) {
      rmSync(importDir, { recursive: true, force: true });
    }
    importDir = mkdtempSync(join(tmpdir(), 'fantasy-assist-test-db-'));
    return importDir;
  }

  // A real `DatabaseClient` (worker + postMessage) can never throw synchronously — a closed
  // client rejects the returned promise. `closedError()` returns that rejection rather than
  // `ensureOpen` throwing, so a caller's `.catch()` (e.g. `board-store.ts`'s `dispatch`) is what
  // observes the failure, exactly as it would against the real worker-backed client.
  function closedError<T>(): Promise<T> {
    return Promise.reject(
      new DatabaseError('DatabaseClient is closed; cannot send a new request.')
    );
  }

  return {
    open() {
      if (closed) return closedError();
      if (!migrated) {
        migrate(wrapTestDatabase(db));
        migrated = true;
      }
      return Promise.resolve();
    },

    load(): Promise<PersistedDatabase> {
      if (closed) return closedError();
      return Promise.resolve(repository.loadAll());
    },

    send(command: DbCommand): Promise<void> {
      if (closed) return closedError();
      repository.applyCommand(command);
      return Promise.resolve();
    },

    sendAll(commands: DbCommand[]): Promise<void> {
      if (closed) return closedError();
      for (const command of commands) {
        repository.applyCommand(command);
      }
      return Promise.resolve();
    },

    exportBytes() {
      if (closed) return closedError();
      return withTempDir(async (dir) => {
        const file = join(dir, 'export.sqlite');
        await backup(db, file);
        return new Uint8Array(readFileSync(file));
      });
    },

    importBytes(bytes: Uint8Array) {
      if (closed) return closedError();
      const dir = replaceImportDir();
      const file = join(dir, 'import.sqlite');
      writeFileSync(file, bytes);
      db.close();
      db = new DatabaseSync(file);
      const executor = wrapTestDatabase(db);
      migrate(executor);
      repository = createRepository(executor);
      return Promise.resolve(repository.loadAll());
    },

    close() {
      closed = true;
      db.close();
      if (importDir) {
        rmSync(importDir, { recursive: true, force: true });
        importDir = null;
      }
    },
  };
}

/**
 * A `DatabaseClient` whose `open()` rejects with `message` — for boot-failure tests (plan §4
 * rule 3's converse: OPFS unavailable surfaces as a rejected `open()`). Every other method also
 * rejects, matching a client nothing was ever successfully opened on.
 */
export function createFailingTestDatabaseClient(message: string): DatabaseClient {
  const error = () => Promise.reject(new DatabaseError(message));
  return {
    open: error,
    load: error,
    send: error,
    sendAll: error,
    exportBytes: error,
    importBytes: error,
    close() {
      // Nothing was ever opened; nothing to tear down.
    },
  };
}
