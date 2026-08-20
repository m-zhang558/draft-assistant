/**
 * Export / import (MVP 4.13, Stage E — supersedes the Phase 3.8 JSON-only path).
 *
 * **Export** -> the raw `.sqlite` byte image (`client.exportBytes()`, via `state/board-store.ts`'s
 * `exportDatabaseBytes`), downloaded as `fantasy-assist-YYYY-MM-DD.sqlite`. This closes the
 * narrowing Stage C's `.json`-only export left in place (see the Stage C report's "multi-board
 * caveat"): a `.sqlite` export is a byte-for-byte copy of the WHOLE database — every board of
 * every format — not "the first board of each format".
 *
 * **Import** accepts BOTH:
 *  - `.sqlite` -> `client.importBytes()` -> rehydrates the store from the returned
 *    `PersistedDatabase` (`importDatabaseBytes`). This REPLACES THE ENTIRE DATABASE and is NOT
 *    undoable (see that function's doc comment in `board-store.ts`), so it is gated behind
 *    `ui/ConfirmButton`'s two-step confirm rather than firing on file selection alone.
 *  - legacy `.json` -> the unchanged Phase 3.8 path (`parseStateJson` + `importState`), which IS
 *    undoable and applies onto the EXISTING boards rather than replacing the database — kept so a
 *    pre-Phase-4 backup still imports; superseding it with `.sqlite` must not orphan it.
 * Dispatch is primarily by file extension (`.sqlite`/`.sqlite3`/`.db` vs `.json`); a file with
 * neither extension is classified by sniffing its first 16 bytes for the SQLite file-format magic
 * header, falling through to the JSON path (and therefore to `parseStateJson`'s own loud,
 * specific error) otherwise — so a mislabelled-but-real `.sqlite` file still imports, and a file
 * that is neither gets a clear inline error either way, exactly as a malformed `.json` already
 * does.
 *
 * --- Honesty about staleness ---
 *
 * `exportBytes()` reads the ACTUAL on-disk/OPFS database, not the in-memory store — every
 * mutation writes through asynchronously and fire-and-forget (`board-store.ts`'s `dispatch`).
 * Ordinarily those two are back in sync a microtask later. But `persistenceError` means the LAST
 * write was rejected and never reached storage, while memory moved on regardless (the store
 * deliberately does not roll memory back on a failed write — see its file header) — so a database
 * exported while `persistenceError` is set could be missing exactly the edit still on screen.
 * Rather than hand the user a backup that silently omits that edit, Export is DISABLED while
 * `persistenceError` is set, with `title`/`aria-description` explaining why before the click
 * rather than after it (mirroring `features/boards/board-manager.tsx`'s disabled-delete pattern).
 *
 * --- The old localStorage backup ---
 *
 * `legacyBackupPresent` (MVP 4.4) is never cleared automatically — it is the only rollback path
 * while OPFS was unproven. Now that a real `.sqlite` export exists, this file adds the one-click
 * "clear the old browser-storage backup" affordance the plan promised, behind its own
 * `ConfirmButton` confirm, worded so the user understands what they are discarding.
 */
import { useCallback, useId, useRef, useState, type ChangeEvent } from 'react';
import {
  clearPersistedState,
  exportDatabaseBytes,
  importDatabaseBytes,
  parseStateJson,
  PersistedStateError,
  useBoardStore,
  type PersistedState,
} from '@/state';
import { Button, ConfirmButton, LiveRegion } from '@/ui';

const SQLITE_MAGIC = 'SQLite format 3\0';

function exportFilename(): string {
  return `fantasy-assist-${new Date().toISOString().slice(0, 10)}.sqlite`;
}

async function looksLikeSqlite(file: File): Promise<boolean> {
  const header = await file.slice(0, SQLITE_MAGIC.length).text();
  return header === SQLITE_MAGIC;
}

/** Extension first (the fast, common path); content-sniffed only when the extension itself
 * doesn't say — see the file header. */
async function classifyImportFile(file: File): Promise<'sqlite' | 'json'> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.sqlite') || name.endsWith('.sqlite3') || name.endsWith('.db')) {
    return 'sqlite';
  }
  if (name.endsWith('.json')) {
    return 'json';
  }
  return (await looksLikeSqlite(file)) ? 'sqlite' : 'json';
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface PendingSqliteImport {
  file: File;
  bytes: Uint8Array;
}

export function BoardIO() {
  const persistenceError = useBoardStore((state) => state.persistenceError);
  const legacyBackupPresent = useBoardStore((state) => state.legacyBackupPresent);

  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<PendingSqliteImport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const handleExport = useCallback(() => {
    void (async () => {
      const bytes = await exportDatabaseBytes(useBoardStore);
      // `Uint8Array<ArrayBufferLike>` (the client's return type) isn't a `BlobPart` on its own —
      // `Blob` wants a concrete `ArrayBuffer`-backed view, which a fresh copy guarantees.
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/x-sqlite3' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = exportFilename();
      // Firefox only honours a programmatic `.click()` as a download trigger when the anchor is
      // connected to the document, so it's attached (invisibly) just long enough to be clicked.
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      // A leaked blob URL pins the whole database in memory for the tab's life, so it must be
      // revoked — but not on this same synchronous turn: Firefox and Safari can cancel a download
      // that hasn't started reading the blob yet if the URL is revoked before the click's turn of
      // the event loop finishes, so the revoke is deferred to the next one instead.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setAnnouncement('Board exported.');
    })();
  }, []);

  const handleImportClick = useCallback(() => {
    setError(null);
    setPendingImport(null);
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-selecting the same filename still fires a change event.
    event.target.value = '';
    if (!file) {
      return;
    }
    setError(null);
    setPendingImport(null);

    const kind = await classifyImportFile(file);

    if (kind === 'sqlite') {
      // A user picking the wrong file is invalid input, not a broken invariant: surface a
      // genuine read failure inline instead of crashing.
      let bytes: Uint8Array;
      try {
        bytes = new Uint8Array(await file.arrayBuffer());
      } catch (readError) {
        setError(`Could not read "${file.name}": ${describeError(readError)}`);
        return;
      }
      // Destructive and not undoable — require the explicit two-step ConfirmButton below rather
      // than importing on selection alone.
      setPendingImport({ file, bytes });
      return;
    }

    let text: string;
    try {
      text = await file.text();
    } catch (readError) {
      setError(`Could not read "${file.name}": ${describeError(readError)}`);
      return;
    }

    let parsed: PersistedState;
    try {
      parsed = parseStateJson(text);
    } catch (parseError) {
      if (parseError instanceof PersistedStateError) {
        setError(parseError.message);
        return;
      }
      throw parseError;
    }

    useBoardStore.getState().importState(parsed);
    setAnnouncement('Board imported from a legacy JSON backup. Press Ctrl+Z to undo.');
  }, []);

  const handleConfirmSqliteImport = useCallback(() => {
    const pending = pendingImport;
    if (!pending) return;
    setPendingImport(null);
    void importDatabaseBytes(useBoardStore, pending.bytes)
      .then(() => {
        setAnnouncement(`Database replaced from "${pending.file.name}". This is not undoable.`);
      })
      .catch((importError: unknown) => {
        setError(`Could not import "${pending.file.name}": ${describeError(importError)}`);
      });
  }, [pendingImport]);

  const handleCancelSqliteImport = useCallback(() => {
    setPendingImport(null);
  }, []);

  const handleClearLegacyBackup = useCallback(() => {
    clearPersistedState(window.localStorage);
    setAnnouncement('Old browser-storage backup cleared.');
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={handleExport}
        variant="secondary"
        size="sm"
        disabled={Boolean(persistenceError)}
        title={
          persistenceError
            ? `Export disabled: your last edit failed to save ("${persistenceError}"), so an exported file could be missing it.`
            : undefined
        }
        aria-description={
          persistenceError ? 'Export is disabled because your last edit failed to save.' : undefined
        }
      >
        Export
      </Button>
      <Button onClick={handleImportClick} variant="secondary" size="sm">
        Import
      </Button>
      <label htmlFor={fileInputId} className="sr-only">
        Import a .sqlite database or a legacy .json backup
      </label>
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept=".sqlite,.sqlite3,.db,.json,application/json"
        className="hidden"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      {pendingImport ? (
        <span className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
          Replace the entire database with &quot;{pendingImport.file.name}&quot;?
          <ConfirmButton
            label="Replace database"
            confirmLabel="Confirm replace"
            onConfirm={handleConfirmSqliteImport}
            variant="danger"
            size="sm"
          />
          <Button variant="ghost" size="sm" onClick={handleCancelSqliteImport}>
            Cancel
          </Button>
        </span>
      ) : null}
      {legacyBackupPresent ? (
        <ConfirmButton
          label="Clear old backup"
          confirmLabel="Confirm clear old backup"
          onConfirm={handleClearLegacyBackup}
          size="sm"
        />
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <LiveRegion message={announcement} label="Import and export status" />
    </div>
  );
}
