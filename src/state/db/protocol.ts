/**
 * Pure types for the worker message boundary, plus the pure part of the dispatch logic
 * (`docs/plans/phase-4-plan.md` §1.1: "request/response message types ← testable"). No import of
 * `worker.ts` or `client.ts` — both of those import this file, never the other way around.
 */
import type { DbCommand } from './commands';
import { DatabaseError } from './sql-executor';
import type { Repository } from './repository';

export type DbRequest =
  | { id: number; kind: 'open' }
  | { id: number; kind: 'load' }
  | { id: number; kind: 'command'; command: DbCommand }
  | { id: number; kind: 'commands'; commands: DbCommand[] }
  | { id: number; kind: 'export' }
  | { id: number; kind: 'import'; bytes: Uint8Array };

export type DbResponse =
  { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string };

/**
 * Dispatches every `DbRequest` kind that `Repository` alone can serve. `export` and `import`
 * need the raw sqlite3 handle (a whole-database byte image) that `Repository` deliberately does
 * not expose, so they are `worker.ts`'s own business: the worker must handle those two kinds
 * itself, before ever reaching this function. Calling `handleRequest` with either kind is a
 * programming error, and it throws rather than returning a placeholder.
 */
export function handleRequest(repository: Repository, request: DbRequest): unknown {
  switch (request.kind) {
    case 'open':
      // By the time a request reaches this dispatcher, `repository` already exists — worker.ts
      // only constructs one after its own async bootstrap (sqlite3 init, VFS install, migrate)
      // has finished. So 'open' here is just a readiness handshake: there is nothing left to do.
      return undefined;

    case 'load':
      return repository.loadAll();

    case 'command':
      repository.applyCommand(request.command);
      return undefined;

    case 'commands':
      for (const command of request.commands) {
        repository.applyCommand(command);
      }
      return undefined;

    case 'export':
    case 'import':
      throw new DatabaseError(
        `handleRequest cannot serve a "${request.kind}" request — it needs the raw sqlite3 ` +
          'handle, which only worker.ts holds. The worker must handle this request kind itself.'
      );

    default: {
      const exhaustiveCheck: never = request;
      throw new DatabaseError(`Unhandled DbRequest kind: ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
