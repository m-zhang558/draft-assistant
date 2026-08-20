/**
 * The one file in `db/` that cannot be tested (`docs/plans/phase-4-plan.md` §1.1) — so it is kept
 * to a bootstrap and a message loop, with no query text and no business rules of its own. Every
 * query lives in `repository.ts`; every migration lives in `schema.ts`; this file's only job is
 * wiring `@sqlite.org/sqlite-wasm` to those through the `SqlExecutor` seam and answering
 * `postMessage`s.
 *
 * VFS choice: `opfs-sahpool`, not `opfs`. The plain `opfs` VFS needs `SharedArrayBuffer` and
 * therefore COOP/COEP response headers, which a static host like GitHub Pages cannot set — see
 * `PROJECT.md` §4 and the Stage B build proof. `opfs-sahpool` avoids that entirely, at the cost of
 * needing an explicit import/export step (`sqlite3_js_db_export` / `SAHPoolUtil#importDb`) rather
 * than a bare file copy, which is what `export`/`import` below implement.
 *
 * If OPFS itself is unavailable (private browsing, an unsupporting browser), `installOpfsSAHPoolVfs`
 * rejects on its own, and that rejection is left to propagate through `ready` untouched — no
 * catch, no fallback to another VFS or another store (`PROJECT.md` §6, plan §4 rule 3's converse).
 */
import sqlite3InitModule, {
  type Database,
  type OpfsSAHPoolDatabase,
  type SAHPoolUtil,
  type Sqlite3Static,
} from '@sqlite.org/sqlite-wasm';
import { migrate } from './schema';
import { createRepository, type Repository } from './repository';
import { handleRequest, type DbRequest, type DbResponse } from './protocol';
import { toSqlRow, type SqlExecutor, type SqlParam } from './sql-executor';

const DB_FILENAME = '/fantasy-assist.sqlite';

function bindOption(params: readonly SqlParam[] | undefined): { bind?: readonly SqlParam[] } {
  return params !== undefined && params.length > 0 ? { bind: params } : {};
}

/** Wraps an open sqlite3 `Database` (any VFS) as a `SqlExecutor` — the same adaptation
 * `sql-executor.test-support.ts` does for `node:sqlite`, so `schema.ts` and `repository.ts` run
 * unmodified against either engine. */
function createSqliteExecutor(db: Database): SqlExecutor {
  return {
    all(sql, params) {
      const rows = db.exec(sql, {
        ...bindOption(params),
        returnValue: 'resultRows',
        rowMode: 'object',
      });
      return rows.map(toSqlRow);
    },
    run(sql, params) {
      db.exec(sql, bindOption(params));
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

interface Context {
  sqlite3: Sqlite3Static;
  poolUtil: SAHPoolUtil;
  db: OpfsSAHPoolDatabase;
  repository: Repository;
}

let context: Context | undefined;

async function boot(): Promise<void> {
  const sqlite3 = await sqlite3InitModule();
  const poolUtil = await sqlite3.installOpfsSAHPoolVfs({});
  const db = new poolUtil.OpfsSAHPoolDb(DB_FILENAME);
  const executor = createSqliteExecutor(db);
  migrate(executor);
  context = { sqlite3, poolUtil, db, repository: createRepository(executor) };
}

/** Resolves once, either to success or to the engine's own rejection (e.g. OPFS unavailable).
 * Every message handler awaits this before doing anything else, so a boot failure surfaces as a
 * rejected `open()` — and every request after it, since a worker that can't open its database
 * can't serve anything. */
const ready: Promise<void> = boot();

function requireContext(): Context {
  if (!context) {
    // `ready` resolved without `context` being set — boot() itself is the only writer, so this
    // would mean boot() returned without assigning it, which is a bug in this file, not a
    // reachable runtime state for a caller to hit.
    throw new Error('Database worker booted without initialising its context.');
  }
  return context;
}

function exportDatabase(ctx: Context): Uint8Array {
  return ctx.sqlite3.capi.sqlite3_js_db_export(ctx.db);
}

/** Closes the current connection, imports `bytes` as the database file under the same VFS name,
 * reopens it, migrates it forward (an imported file may predate this build's schema), and returns
 * the freshly reopened contents — the same shape `load` returns, so the caller never has to issue
 * a separate `load` after `import`. */
async function importDatabase(ctx: Context, bytes: Uint8Array) {
  ctx.db.close();
  await ctx.poolUtil.importDb(DB_FILENAME, bytes);
  const db = new ctx.poolUtil.OpfsSAHPoolDb(DB_FILENAME);
  const executor = createSqliteExecutor(db);
  migrate(executor);
  const repository = createRepository(executor);
  context = { ...ctx, db, repository };
  return repository.loadAll();
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function postResponse(response: DbResponse): void {
  postMessage(response);
}

async function handleMessage(request: DbRequest): Promise<void> {
  try {
    await ready;
    const ctx = requireContext();

    let result: unknown;
    if (request.kind === 'export') {
      result = exportDatabase(ctx);
    } else if (request.kind === 'import') {
      result = await importDatabase(ctx, request.bytes);
    } else {
      result = handleRequest(ctx.repository, request);
    }

    postResponse({ id: request.id, ok: true, result });
  } catch (error) {
    postResponse({ id: request.id, ok: false, error: describeError(error) });
  }
}

addEventListener('message', (event) => {
  const request = event.data as DbRequest;
  void handleMessage(request);
});
