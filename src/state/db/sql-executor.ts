/**
 * The seam between SQL and the engine that runs it (`docs/plans/phase-4-plan.md` §1.1).
 *
 * Everything in `db/` above this file — `schema.ts`, `repository.ts`, `commands.ts` — is written
 * against `SqlExecutor` and never against a concrete engine, which is what makes it testable:
 * tests hand it `node:sqlite`'s `DatabaseSync` (see `sql-executor.test-support.ts`), production
 * hands it `@sqlite.org/sqlite-wasm`'s `oo1.DB` wrapper (see `worker.ts`). Same interface, same
 * SQL, two different engines underneath.
 */

/** One result row. Column values are exactly what SQLite can return for this schema (§3.1 of
 * the plan uses only TEXT, INTEGER, and REAL columns — no BLOB — but the type stays honest about
 * what SQLite itself is capable of returning). */
export interface SqlRow {
  readonly [column: string]: string | number | null | Uint8Array;
}

export type SqlParam = string | number | null | Uint8Array;

export interface SqlExecutor {
  /** Runs a statement, returning result rows (empty for a non-SELECT statement). */
  all(sql: string, params?: readonly SqlParam[]): SqlRow[];
  /** Runs a statement, discarding any result rows. */
  run(sql: string, params?: readonly SqlParam[]): void;
  /**
   * Runs `fn` inside a transaction: commits on normal return, rolls back and rethrows whatever
   * `fn` threw. `fn` must only call this executor's own `all`/`run` — nesting `transaction`
   * calls is not supported by either backing engine.
   */
  transaction<T>(fn: () => T): T;
}

/**
 * Thrown by everything in `db/` for a fail-fast report (PROJECT.md §6): a query that could not
 * be prepared, a row that fails validation on read, a schema newer than this build understands.
 * Mirrors `PersistedStateError`'s shape and voice (`state/persistence.ts`) — no silent recovery,
 * a message specific enough to act on.
 */
export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Narrows a raw column value from a SQL engine binding into exactly what `SqlRow` allows. Both
 * real engines can, in principle, hand back a wider set of JS types than this schema ever
 * produces (`@sqlite.org/sqlite-wasm`'s `SqlValue` also includes `bigint`, `Int8Array`, and
 * `ArrayBuffer`; `node:sqlite`'s `SQLOutputValue` also includes `bigint`). This schema
 * (`schema.ts`) only ever uses TEXT, INTEGER, REAL, and NULL columns, so anything outside
 * `SqlRow`'s shape is a sign something is wrong, not a case to coerce silently.
 *
 * Used by both `worker.ts` (the wasm engine) and `sql-executor.test-support.ts` (the Node test
 * engine) so this assumption lives in one place instead of being duplicated in each.
 */
export function toSqlRow(record: Record<string, unknown>): SqlRow {
  const row: { [column: string]: string | number | null | Uint8Array } = {};
  for (const [column, value] of Object.entries(record)) {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
      row[column] = value;
    } else if (value instanceof Uint8Array) {
      row[column] = value;
    } else {
      throw new DatabaseError(
        `Column "${column}" returned a value of type ${typeof value}, which this schema never ` +
          'produces (only TEXT, INTEGER, REAL, and NULL columns are used).'
      );
    }
  }
  return row;
}
