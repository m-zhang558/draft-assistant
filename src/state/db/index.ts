/**
 * Public surface of `db/`. `worker.ts` is deliberately not re-exported here — it is only ever
 * reached via `new Worker(new URL('./worker.ts', ...))` in `client.ts`, never imported as a
 * module (see `docs/plans/phase-4-plan.md` §1.1).
 */
export { DatabaseError, type SqlExecutor, type SqlParam, type SqlRow } from './sql-executor';

export { SCHEMA_VERSION, MIGRATIONS, migrate, readSchemaVersion } from './schema';

export type {
  DbCommand,
  BoardPlayerRow,
  SetDraftedCommand,
  SetWatchedCommand,
  SetTierBreakCommand,
  SetNoteCommand,
  MoveSortKeyCommand,
  RenormaliseOrderCommand,
  ReplaceBoardRowsCommand,
  CreateBoardCommand,
  RenameBoardCommand,
  DeleteBoardCommand,
  SetSettingCommand,
  DeleteSettingCommand,
} from './commands';

/** `BoardMeta` is canonically defined in `@/domain` (`domain/boards.ts`) — re-exported here so
 * callers reaching for `db/`'s public surface do not also need a separate `@/domain` import. */
export type { BoardMeta } from '@/domain';

export {
  createRepository,
  type Repository,
  type PersistedBoardRow,
  type PersistedBoardRecord,
  type PersistedDatabase,
} from './repository';

export { handleRequest, type DbRequest, type DbResponse } from './protocol';

export {
  createDatabaseClient,
  createBrowserDatabaseClient,
  type DatabaseClient,
  type WorkerLike,
} from './client';
