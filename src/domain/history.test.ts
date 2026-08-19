import {
  canRedo,
  canUndo,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  pushHistory,
  redoHistory,
  undoHistory,
  type History,
} from './history';

describe('pushHistory', () => {
  it('pushes the present onto an empty past', () => {
    const history = pushHistory(EMPTY_HISTORY, 'a');
    expect(history.past).toEqual(['a']);
    expect(history.future).toEqual([]);
  });

  it('appends to an existing past, preserving order (oldest first)', () => {
    const history = pushHistory({ past: ['a'], future: [] }, 'b');
    expect(history.past).toEqual(['a', 'b']);
  });

  it('clears future — a new edit invalidates any pending redo', () => {
    const history = pushHistory({ past: ['a'], future: ['b', 'c'] }, 'd');
    expect(history.future).toEqual([]);
  });

  it('does not mutate the input history', () => {
    const input: History<string> = { past: ['a'], future: ['b'] };
    pushHistory(input, 'c');
    expect(input.past).toEqual(['a']);
    expect(input.future).toEqual(['b']);
  });

  it('drops the oldest entry once past exceeds the limit, keeping the newest', () => {
    let history: History<number> = EMPTY_HISTORY;
    for (let i = 0; i < 5; i++) {
      history = pushHistory(history, i, 3);
    }
    // Pushed 0,1,2,3,4 with limit 3 -> only the newest 3 survive.
    expect(history.past).toEqual([2, 3, 4]);
  });

  it('uses HISTORY_LIMIT as the default limit', () => {
    let history: History<number> = EMPTY_HISTORY;
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) {
      history = pushHistory(history, i);
    }
    expect(history.past.length).toBe(HISTORY_LIMIT);
    expect(history.past[0]).toBe(10);
    expect(history.past[history.past.length - 1]).toBe(HISTORY_LIMIT + 9);
  });
});

describe('undoHistory', () => {
  it('returns null when past is empty', () => {
    expect(undoHistory(EMPTY_HISTORY, 'present')).toBeNull();
  });

  it('restores the most recent past entry and pushes present onto future', () => {
    const history: History<string> = { past: ['a', 'b'], future: [] };
    const result = undoHistory(history, 'present');
    expect(result).not.toBeNull();
    expect(result?.present).toBe('b');
    expect(result?.history.past).toEqual(['a']);
    expect(result?.history.future).toEqual(['present']);
  });

  it('does not mutate the input history', () => {
    const input: History<string> = { past: ['a', 'b'], future: [] };
    undoHistory(input, 'present');
    expect(input.past).toEqual(['a', 'b']);
    expect(input.future).toEqual([]);
  });
});

describe('redoHistory', () => {
  it('returns null when future is empty', () => {
    expect(redoHistory(EMPTY_HISTORY, 'present')).toBeNull();
  });

  it('restores the most recent future entry and pushes present back onto past', () => {
    const history: History<string> = { past: ['a'], future: ['b', 'c'] };
    const result = redoHistory(history, 'present');
    expect(result).not.toBeNull();
    expect(result?.present).toBe('b');
    expect(result?.history.past).toEqual(['a', 'present']);
    expect(result?.history.future).toEqual(['c']);
  });
});

describe('undo -> redo -> undo round trip', () => {
  it('returns to the same present and history contents at each step', () => {
    let history: History<string> = EMPTY_HISTORY;
    history = pushHistory(history, 'a');
    history = pushHistory(history, 'b');
    let present = 'c';

    const undone = undoHistory(history, present);
    expect(undone).not.toBeNull();
    history = undone!.history;
    present = undone!.present;
    expect(present).toBe('b');

    const redone = redoHistory(history, present);
    expect(redone).not.toBeNull();
    history = redone!.history;
    present = redone!.present;
    expect(present).toBe('c');
    expect(history.past).toEqual(['a', 'b']);
    expect(history.future).toEqual([]);

    const undoneAgain = undoHistory(history, present);
    expect(undoneAgain).not.toBeNull();
    history = undoneAgain!.history;
    present = undoneAgain!.present;
    expect(present).toBe('b');
    expect(history.past).toEqual(['a']);
    expect(history.future).toEqual(['c']);
  });
});

describe('canUndo / canRedo', () => {
  it('are false for an empty history', () => {
    expect(canUndo(EMPTY_HISTORY)).toBe(false);
    expect(canRedo(EMPTY_HISTORY)).toBe(false);
  });

  it('track past and future independently', () => {
    const history: History<string> = { past: ['a'], future: [] };
    expect(canUndo(history)).toBe(true);
    expect(canRedo(history)).toBe(false);

    const undone = undoHistory(history, 'present');
    expect(undone).not.toBeNull();
    expect(canUndo(undone!.history)).toBe(false);
    expect(canRedo(undone!.history)).toBe(true);
  });
});
