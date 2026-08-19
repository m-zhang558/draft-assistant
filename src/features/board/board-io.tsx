/**
 * Export / import (MVP 3.8): the backup for a browser wipe. Round-trips through the exact same
 * validated shape `localStorage` uses — `serializeState`/`parseStateJson` (from `@/state`) do
 * the actual serialization and validation (including migrating a v1 file forward);
 * `importState` (already wired into the undo stack by an earlier pass) applies the result.
 *
 * Export has to assemble a `PersistedState` itself: `board-store.ts`'s `toPersistedState`
 * helper is internal, and this component must not reach into `state/**`'s implementation. The
 * `FORMATS` loop converting each format's `drafted` Set to an Array is the one bit of
 * unavoidable duplication of that helper's shape — everything else here is just reading fields
 * straight off `useBoardStore.getState()`.
 */
import { useCallback, useId, useRef, useState, type ChangeEvent } from 'react';
import { FORMATS, type Format } from '@/domain';
import {
  PersistedStateError,
  STORAGE_SCHEMA_VERSION,
  parseStateJson,
  serializeState,
  useBoardStore,
  type PersistedBoard,
  type PersistedState,
} from '@/state';
import { Button, LiveRegion } from '@/ui';

/** Mirrors `board-store.ts`'s internal `toPersistedState` — see file header. */
function buildPersistedState(): PersistedState {
  const state = useBoardStore.getState();
  const boards = {} as Record<Format, PersistedBoard>;

  for (const format of FORMATS) {
    const slice = state.boards[format];
    boards[format] = { order: slice.order, drafted: Array.from(slice.drafted) };
  }

  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeFormat: state.activeFormat,
    boards,
    filters: { position: state.position, availableOnly: state.availableOnly },
    preferences: { theme: state.theme, density: state.density },
  };
}

function exportFilename(): string {
  return `fantasy-assist-${new Date().toISOString().slice(0, 10)}.json`;
}

export function BoardIO() {
  const [announcement, setAnnouncement] = useState('');
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const fileInputId = useId();

  const handleExport = useCallback(() => {
    const json = serializeState(buildPersistedState());
    const blob = new Blob([json], { type: 'application/json' });
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
    // A leaked blob URL pins the whole board in memory for the tab's life, so it must be
    // revoked — but not on this same synchronous turn: Firefox and Safari can cancel a download
    // that hasn't started reading the blob yet if the URL is revoked before the click's turn of
    // the event loop finishes, so the revoke is deferred to the next one instead.
    setTimeout(() => URL.revokeObjectURL(url), 0);
    setAnnouncement('Board exported.');
  }, []);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset immediately so re-selecting the same filename still fires a change event.
    event.target.value = '';
    if (!file) {
      return;
    }

    // A user picking the wrong file is invalid input, not a broken invariant: surface
    // `PersistedStateError` (and a genuine file-read failure) inline instead of crashing or
    // swallowing it. Any other exception type is a real bug and must propagate uncaught.
    let text: string;
    try {
      text = await file.text();
    } catch (readError) {
      const detail = readError instanceof Error ? readError.message : String(readError);
      setError(`Could not read "${file.name}": ${detail}`);
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
    setError(null);
    setAnnouncement('Board imported. Press Ctrl+Z to undo.');
  }, []);

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleExport} variant="secondary" size="sm">
        Export
      </Button>
      <Button onClick={handleImportClick} variant="secondary" size="sm">
        Import
      </Button>
      <label htmlFor={fileInputId} className="sr-only">
        Import board backup JSON file
      </label>
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(event) => {
          void handleFileChange(event);
        }}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <LiveRegion message={announcement} label="Import and export status" />
    </div>
  );
}
