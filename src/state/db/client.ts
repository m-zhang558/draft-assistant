/**
 * Main-thread proxy for the database worker: turns `postMessage` into promises by correlating
 * requests to responses with a monotonically increasing id (`docs/plans/phase-4-plan.md` §1.1,
 * §4 rule 3 — writes are fire-and-forget from the caller's perspective in the store, but every
 * one of them is still a promise here, so a failure is never silently lost).
 *
 * `createDatabaseClient` takes an injected `WorkerLike` rather than constructing a `Worker`
 * itself, so tests can drive it with a fake that implements `postMessage`/`addEventListener`
 * without touching a real Worker thread. `createBrowserDatabaseClient` is the one place that
 * spawns the real thing.
 *
 * Fail fast (PROJECT.md §6): a `{ ok: false }` response rejects with a `DatabaseError` carrying
 * the worker's own message. A worker `error` event — the worker thread itself crashing — rejects
 * every in-flight request rather than leaving callers hanging forever; there is no retry and no
 * fallback to another store.
 */
import type { DbCommand } from './commands';
import type { DbRequest, DbResponse } from './protocol';
import type { PersistedDatabase } from './repository';
import { DatabaseError } from './sql-executor';

export interface DatabaseClient {
  open(): Promise<void>;
  load(): Promise<PersistedDatabase>;
  send(command: DbCommand): Promise<void>;
  sendAll(commands: DbCommand[]): Promise<void>;
  exportBytes(): Promise<Uint8Array>;
  importBytes(bytes: Uint8Array): Promise<PersistedDatabase>;
  close(): void;
}

/** The minimal `Worker` surface the client needs. A real `Worker` satisfies this structurally;
 * tests supply a fake that implements just these four members. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<DbResponse>) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  terminate(): void;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export function createDatabaseClient(worker: WorkerLike): DatabaseClient {
  const pending = new Map<number, PendingRequest>();
  let nextId = 1;
  let closed = false;

  worker.addEventListener('message', (event) => {
    const response = event.data;
    const entry = pending.get(response.id);
    if (!entry) {
      // No matching in-flight request — either already settled by handleWorkerError below, or a
      // response for an id we never sent. Either way there is nothing to resolve.
      return;
    }
    pending.delete(response.id);
    if (response.ok) {
      entry.resolve(response.result);
    } else {
      entry.reject(new DatabaseError(response.error));
    }
  });

  worker.addEventListener('error', (event) => {
    const detail = event.message.length > 0 ? event.message : 'unknown error';
    const error = new DatabaseError(`Database worker crashed: ${detail}`);
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending.clear();
  });

  function enqueue<T>(request: DbRequest): Promise<T> {
    if (closed) {
      return Promise.reject(
        new DatabaseError('DatabaseClient is closed; cannot send a new request.')
      );
    }
    return new Promise<T>((resolve, reject) => {
      pending.set(request.id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage(request);
    });
  }

  function nextRequestId(): number {
    const id = nextId;
    nextId += 1;
    return id;
  }

  return {
    open: () => enqueue<void>({ id: nextRequestId(), kind: 'open' }),
    load: () => enqueue<PersistedDatabase>({ id: nextRequestId(), kind: 'load' }),
    send: (command) => enqueue<void>({ id: nextRequestId(), kind: 'command', command }),
    sendAll: (commands) => enqueue<void>({ id: nextRequestId(), kind: 'commands', commands }),
    exportBytes: () => enqueue<Uint8Array>({ id: nextRequestId(), kind: 'export' }),
    importBytes: (bytes) =>
      enqueue<PersistedDatabase>({ id: nextRequestId(), kind: 'import', bytes }),
    close: () => {
      closed = true;
      worker.terminate();
    },
  };
}

/** Spawns the real worker (`worker.ts`) and wraps it with `createDatabaseClient`. This is the
 * only function in `db/` that constructs a `Worker`. */
export function createBrowserDatabaseClient(): DatabaseClient {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  return createDatabaseClient(worker);
}
