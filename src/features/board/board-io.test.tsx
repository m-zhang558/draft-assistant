import { act, render, screen, fireEvent } from '@testing-library/react';
import { FORMATS } from '@/domain';
import { getRankings, parseStateJson, useBoardStore, type PersistedState } from '@/state';
import { BoardIO } from './board-io';

/**
 * The board store is a module-level singleton backed by real `window.localStorage` (see
 * `board.test.tsx`) — it only hydrates once, so every test drives it back to known defaults.
 */
function resetStore() {
  const store = useBoardStore.getState();
  act(() => {
    store.setFormat('dynasty-sf');
    useBoardStore.getState().clearDrafted();
    useBoardStore.getState().resetOrder();
    useBoardStore.getState().setFormat('redraft-ppr');
    useBoardStore.getState().clearDrafted();
    useBoardStore.getState().resetOrder();
    useBoardStore.getState().setPosition('ALL');
    useBoardStore.getState().setSearch('');
    useBoardStore.getState().setAvailableOnly(true);
  });
}

function ioStatus(): HTMLElement {
  return screen.getByRole('status', { name: 'Import and export status' });
}

function makeFile(text: string, name = 'backup.json'): File {
  return new File([text], name, { type: 'application/json' });
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
  beforeEach(() => {
    window.localStorage.clear();
    resetStore();
  });

  afterEach(() => {
    // Guards against a failed assertion leaving fake timers active for a later test.
    vi.useRealTimers();
  });

  it('exports a JSON file that parseStateJson accepts, matching the current store state', async () => {
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

    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(ioStatus()).toHaveTextContent('Board exported.');

    expect(capturedBlob).not.toBeNull();
    const text = await (capturedBlob as unknown as Blob).text();
    const parsed = parseStateJson(text);
    expect(parsed.activeFormat).toBe(useBoardStore.getState().activeFormat);
    expect(parsed.boards['redraft-ppr'].drafted).toContain(playerId);
    expect(parsed.boards['redraft-ppr'].order).toEqual(
      useBoardStore.getState().boards['redraft-ppr'].order
    );

    // revokeObjectURL must not fire synchronously — see board-io.tsx's handleExport comment.
    expect(revokeSpy).not.toHaveBeenCalled();
  });

  it('attaches the anchor to the document for the click, removes it after, and defers the URL revoke', () => {
    let anchorWasConnectedAtClick: boolean | null = null;
    // `this` inside the spy is the clicked anchor, but aliasing `this` to a variable trips
    // eslint's `no-this-alias` — pushed into an array instead, which the rule doesn't flag.
    const clickedAnchors: HTMLAnchorElement[] = [];
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement
    ) {
      clickedAnchors.push(this);
      anchorWasConnectedAtClick = document.body.contains(this);
    });
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');

    vi.useFakeTimers();
    render(<BoardIO />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(anchorWasConnectedAtClick).toBe(true);
    expect(clickedAnchors).toHaveLength(1);
    const clickedAnchor = clickedAnchors[0]!;
    expect(document.body.contains(clickedAnchor)).toBe(false);
    expect(clickedAnchor.isConnected).toBe(false);

    // Not revoked on the same synchronous turn as the click...
    expect(revokeSpy).not.toHaveBeenCalled();

    vi.runAllTimers();

    // ...but revoked once the deferred turn runs.
    expect(revokeSpy).toHaveBeenCalledTimes(1);
  });

  it('imports a valid schemaVersion-2 file and announces the undoable success', async () => {
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
    const input = screen.getByLabelText('Import board backup JSON file');
    const file = makeFile(JSON.stringify(payload));

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      // let the async file.text()/import chain settle
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useBoardStore.getState().activeFormat).toBe('dynasty-sf');
    expect(useBoardStore.getState().boards['dynasty-sf'].drafted.has(dynastyPlayerId)).toBe(true);
    expect(useBoardStore.getState().theme).toBe('dark');
    expect(ioStatus()).toHaveTextContent('Board imported. Press Ctrl+Z to undo.');
  });

  it('shows an inline alert for malformed JSON and leaves the board state untouched', async () => {
    render(<BoardIO />);
    const input = screen.getByLabelText('Import board backup JSON file');
    const boardsBefore = useBoardStore.getState().boards;
    const file = makeFile('{not valid json');

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/import contains invalid JSON/);
    expect(useBoardStore.getState().boards).toBe(boardsBefore);
  });

  it('imports a v1-schema file, proving the migration path is reachable from the file picker', async () => {
    render(<BoardIO />);
    const input = screen.getByLabelText('Import board backup JSON file');
    const file = makeFile(JSON.stringify(v1Payload()));

    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(useBoardStore.getState().activeFormat).toBe('redraft-ppr');
    // v1 carried no preferences -> migrated to the documented defaults.
    expect(useBoardStore.getState().theme).toBe('system');
    expect(useBoardStore.getState().density).toBe('comfortable');
    expect(ioStatus()).toHaveTextContent('Board imported. Press Ctrl+Z to undo.');
  });
});
