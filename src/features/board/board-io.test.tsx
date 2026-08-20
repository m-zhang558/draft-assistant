import { act, fireEvent, render, screen } from '@testing-library/react';
import { FORMATS } from '@/domain';
import {
  activeBoard,
  exportDatabaseBytes,
  getRankings,
  useBoardStore,
  type PersistedState,
} from '@/state';
import { BoardIO } from './board-io';
import { boardIdForFormat, resetBoardStore } from '../../../tests/test-store';

function ioStatus(): HTMLElement {
  return screen.getByRole('status', { name: 'Import and export status' });
}

function makeFile(bytes: BlobPart, name: string, type: string): File {
  return new File([bytes], name, { type });
}

function jsonFile(text: string, name = 'backup.json'): File {
  return makeFile(text, name, 'application/json');
}

async function sqliteFile(name = 'backup.sqlite'): Promise<File> {
  const bytes = await exportDatabaseBytes(useBoardStore);
  return makeFile(new Uint8Array(bytes), name, 'application/x-sqlite3');
}

/** A minimal, hand-built schemaVersion-1 payload — no `preferences` block (see persistence.ts). */
function v1Payload(): Record<string, unknown> {
  const boards: Record<string, unknown> = {};
  for (const format of FORMATS) {
    boards[format] = { order: [], drafted: [] };
  }
  return {
    schemaVersion: 1,
    activeFormat: 'redraft-ppr',
    boards,
    filters: { position: 'ALL', availableOnly: true },
  };
}

describe('BoardIO', () => {
  beforeEach(async () => {
    await resetBoardStore();
  });

  afterEach(() => {
    // Guards against a failed assertion leaving fake timers active for a later test.
    vi.useRealTimers();
  });

  it('exports a .sqlite file whose bytes match client.exportBytes()', async () => {
    const playerId = getRankings('redraft-ppr').players[0]!.id;
    act(() => {
      useBoardStore.getState().toggleDrafted(playerId);
    });

    let capturedBlob: Blob | null = null;
    const createSpy = vi.spyOn(URL, 'createObjectURL').mockImplementation((obj) => {
      capturedBlob = obj as Blob;
      return 'blob:mock';
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    render(<BoardIO />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    // The export is async now (client.exportBytes() reads the real, on-disk-backed test
    // database via node:sqlite's backup() — genuine I/O, not just a microtask), so wait for it
    // rather than assuming a fixed number of Promise.resolve() ticks settles it.
    await act(async () => {
      await vi.waitFor(() => expect(createSpy).toHaveBeenCalledTimes(1));
    });

    expect(ioStatus()).toHaveTextContent('Board exported.');

    expect(capturedBlob).not.toBeNull();
    const bytes = new Uint8Array(await (capturedBlob as unknown as Blob).arrayBuffer());
    const header = new TextDecoder().decode(bytes.slice(0, 16));
    expect(header).toBe('SQLite format 3\0');

    await vi.waitFor(() => expect(revokeSpy).toHaveBeenCalledTimes(1));
  });

  it('is disabled while persistenceError is set, with a title explaining why', () => {
    act(() => {
      useBoardStore.setState({ persistenceError: 'disk full' });
    });
    render(<BoardIO />);

    const exportButton = screen.getByRole('button', { name: 'Export' });
    expect(exportButton).toBeDisabled();
    expect(exportButton).toHaveAttribute('title', expect.stringContaining('disk full'));
  });

  it('attaches the anchor to the document for the click, removes it after, and defers the URL revoke via setTimeout', async () => {
    // Note: export is now async (it awaits the real `client.exportBytes()` I/O), so — unlike
    // the old fully-synchronous JSON export — this test cannot observe "revoke hasn't fired
    // yet" as a same-tick assertion with real timers (any await it takes to detect the click
    // gives that same 0ms timeout a chance to fire too). What it CAN and does verify is the
    // thing that actually matters: the anchor is connected for the click (Firefox's
    // requirement), removed after, and the revoke is issued through `setTimeout(fn, 0)`
    // specifically — never called inline — which is the deferral `handleExport` promises.
    let anchorWasConnectedAtClick: boolean | null = null;
    const clickedAnchors: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clickedAnchors.push(this);
      anchorWasConnectedAtClick = document.body.contains(this);
    });
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    render(<BoardIO />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await act(async () => {
      await vi.waitFor(() => expect(revokeSpy).toHaveBeenCalledTimes(1));
    });

    expect(anchorWasConnectedAtClick).toBe(true);
    expect(clickedAnchors).toHaveLength(1);
    const clickedAnchor = clickedAnchors[0]!;
    expect(document.body.contains(clickedAnchor)).toBe(false);
    expect(clickedAnchor.isConnected).toBe(false);
    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 0);
  });

  it('imports a .sqlite file behind a two-step confirm, replacing the whole database', async () => {
    const dynastyPlayerId = getRankings('dynasty-sf').players[0]!.id;
    // Build the .sqlite bytes from a store state distinguishable from a fresh cold start.
    act(() => {
      useBoardStore.getState().setActiveBoard(boardIdForFormat('dynasty-sf'));
      useBoardStore.getState().toggleDrafted(dynastyPlayerId);
    });
    const file = await sqliteFile();

    // Reset back to a plain cold start before "importing" — proves the import genuinely
    // replaces the database rather than the test coincidentally already matching.
    await resetBoardStore();
    expect(activeBoard(useBoardStore.getState()).drafted.has(dynastyPlayerId)).toBe(false);

    render(<BoardIO />);
    const input = screen.getByLabelText('Import a .sqlite database or a legacy .json backup');

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Selecting the file alone must NOT have imported anything yet.
    expect(activeBoard(useBoardStore.getState()).drafted.has(dynastyPlayerId)).toBe(false);
    expect(screen.getByText(/Replace the entire database/)).toBeInTheDocument();

    const confirmButton = screen.getByRole('button', { name: 'Replace database' });
    fireEvent.click(confirmButton); // arms
    fireEvent.click(screen.getByRole('button', { name: 'Confirm replace' })); // confirms

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const dynastyBoardId = boardIdForFormat('dynasty-sf');
    expect(useBoardStore.getState().boards[dynastyBoardId]!.drafted.has(dynastyPlayerId)).toBe(
      true
    );
    expect(ioStatus()).toHaveTextContent('This is not undoable.');
    expect(useBoardStore.getState().canUndo).toBe(false);
  });

  it('cancelling a pending .sqlite import leaves the database untouched', async () => {
    const file = await sqliteFile();
    render(<BoardIO />);
    const input = screen.getByLabelText('Import a .sqlite database or a legacy .json backup');
    const boardsBefore = useBoardStore.getState().boards;

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/Replace the entire database/)).not.toBeInTheDocument();
    expect(useBoardStore.getState().boards).toBe(boardsBefore);
  });

  it('imports a valid schemaVersion-2 .json file through the legacy, undoable path', async () => {
    const dynastyPlayerId = getRankings('dynasty-sf').players[0]!.id;
    const payload: PersistedState = {
      schemaVersion: 2,
      activeFormat: 'dynasty-sf',
      boards: {
        'redraft-ppr': { order: [], drafted: [] },
        'dynasty-sf': { order: [dynastyPlayerId], drafted: [dynastyPlayerId] },
      },
      filters: { position: 'ALL', availableOnly: true },
      preferences: { theme: 'dark', density: 'compact' },
    };

    render(<BoardIO />);
    const input = screen.getByLabelText('Import a .sqlite database or a legacy .json backup');
    const file = jsonFile(JSON.stringify(payload));

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    const active = activeBoard(useBoardStore.getState());
    expect(active.format).toBe('dynasty-sf');
    expect(active.drafted.has(dynastyPlayerId)).toBe(true);
    expect(useBoardStore.getState().theme).toBe('dark');
    expect(ioStatus()).toHaveTextContent(
      'Board imported from a legacy JSON backup. Press Ctrl+Z to undo.'
    );
    expect(useBoardStore.getState().canUndo).toBe(true);
  });

  it('shows an inline alert for malformed JSON and leaves the board state untouched', async () => {
    render(<BoardIO />);
    const input = screen.getByLabelText('Import a .sqlite database or a legacy .json backup');
    const boardsBefore = useBoardStore.getState().boards;
    const file = jsonFile('{not valid json');

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/import contains invalid JSON/);
    expect(useBoardStore.getState().boards).toBe(boardsBefore);
  });

  it('imports a v1-schema .json file, proving the migration path is reachable from the file picker', async () => {
    render(<BoardIO />);
    const input = screen.getByLabelText('Import a .sqlite database or a legacy .json backup');
    const file = jsonFile(JSON.stringify(v1Payload()));

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(activeBoard(useBoardStore.getState()).format).toBe('redraft-ppr');
    expect(useBoardStore.getState().activeBoardId).toBe(boardIdForFormat('redraft-ppr'));
    // v1 carried no preferences -> migrated to the documented defaults.
    expect(useBoardStore.getState().theme).toBe('system');
    expect(useBoardStore.getState().density).toBe('comfortable');
  });

  it('gives a clear inline error for a file that is neither a .sqlite database nor JSON', async () => {
    render(<BoardIO />);
    const input = screen.getByLabelText('Import a .sqlite database or a legacy .json backup');
    const file = makeFile('not json and not sqlite either', 'notes.txt', 'text/plain');

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Neither extension nor content says "sqlite", so it falls through to the JSON path and
    // gets that parser's own loud, specific error — still a clear inline message either way.
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('offers to clear the old localStorage backup only while it is present, behind a confirm', () => {
    render(<BoardIO />);
    expect(screen.queryByRole('button', { name: 'Clear old backup' })).not.toBeInTheDocument();

    act(() => {
      useBoardStore.setState({ legacyBackupPresent: true });
      window.localStorage.setItem('fantasy-assist.state', '{}');
    });
    render(<BoardIO />);

    const clearButton = screen.getAllByRole('button', { name: 'Clear old backup' })[0]!;
    fireEvent.click(clearButton); // arms
    fireEvent.click(screen.getByRole('button', { name: 'Confirm clear old backup' }));

    expect(window.localStorage.getItem('fantasy-assist.state')).toBeNull();
  });
});
