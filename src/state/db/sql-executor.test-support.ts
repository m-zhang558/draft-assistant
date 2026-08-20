/**
 * Test-only `SqlExecutor` backed by `node:sqlite`'s `DatabaseSync` — a REAL SQLite engine, not a
 * mock (`docs/plans/phase-4-plan.md` §1.1: "tests supply a real SQL engine rather than a mock").
 * Every `db/` test that needs an engine uses this, so migrations, `CHECK` constraints,
 * `ON DELETE CASCADE`, and fractional `sort_order` updates are all exercised against real SQLite
 * semantics rather than a hand-rolled fake of them.
 *
 * `node:sqlite` is flagged experimental in Node 22.19 (this project's toolchain) and is used ONLY
 * here, in tests — the shipped engine is `@sqlite.org/sqlite-wasm` (`worker.ts`). Nothing outside
 * a `*.test.ts` file imports this module; it is not reachable from any entry point Vite bundles.
 */
import { DatabaseSync } from 'node:sqlite';
import { toSqlRow, type SqlExecutor } from './sql-executor';

/** Wraps an already-open `DatabaseSync` as a `SqlExecutor` — the same adaptation `worker.ts`'s
 * `createSqliteExecutor` performs for the wasm engine. Factored out (rather than inlined in
 * `createTestSqlExecutor`) so `client.test-support.ts` can rebuild an executor after swapping the
 * underlying `DatabaseSync` on a `.sqlite` import (MVP 4.13), the way `worker.ts`'s
 * `importDatabase` does for the real engine. */
export function wrapTestDatabase(db: DatabaseSync): SqlExecutor {
  return {
    all(sql, params = []) {
      return db
        .prepare(sql)
        .all(...params)
        .map(toSqlRow);
    },
    run(sql, params = []) {
      db.prepare(sql).run(...params);
    },
    transaction(fn) {
      db.exec('BEGIN');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/** A fresh, in-memory SQLite database wrapped as a `SqlExecutor`. Each call returns its own
 * database, isolated from every other test. */
export function createTestSqlExecutor(): SqlExecutor {
  return wrapTestDatabase(new DatabaseSync(':memory:'));
}
