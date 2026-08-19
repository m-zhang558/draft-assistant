/**
 * Generic undo/redo stacks for Fantasy Assist's board editor.
 *
 * Deliberately generic on the snapshot type `T`: `domain/` must not know about `BoardSlice` or
 * any other higher-layer type — that would violate the data → domain → state layering enforced
 * by ESLint's `no-restricted-imports` boundary (PROJECT.md §5). `state/` supplies its own
 * snapshot shape and gets undo/redo for free.
 *
 * Pure and immutable: every function returns a new `History`, never mutates `past` or `future`.
 */

export interface History<T> {
  /** Oldest first, most recent last. The top of the undo stack is `past[past.length - 1]`. */
  readonly past: readonly T[];
  /** Most recently undone first. The top of the redo stack is `future[0]`. */
  readonly future: readonly T[];
}

/** Maximum number of snapshots retained in `past` before the oldest is dropped. */
export const HISTORY_LIMIT = 50;

/**
 * An empty history for any snapshot type `T`. A single frozen instance is safe to share because
 * `History` is never mutated — only replaced.
 */
export const EMPTY_HISTORY: History<never> = { past: [], future: [] };

/**
 * Pushes `present` onto `past` and clears `future` — a new edit invalidates any redo that was
 * pending. Once `past` exceeds `limit`, the oldest entry is dropped so the stack cannot grow
 * without bound.
 */
export function pushHistory<T>(
  history: History<T>,
  present: T,
  limit: number = HISTORY_LIMIT
): History<T> {
  const past = [...history.past, present];
  const overflow = past.length - limit;
  return {
    past: overflow > 0 ? past.slice(overflow) : past,
    future: [],
  };
}

/**
 * Restores the most recently pushed snapshot, moving `present` onto `future` so it can be
 * redone. `null` when `past` is empty — nothing to undo, which is a legitimate state, not an
 * error.
 */
export function undoHistory<T>(
  history: History<T>,
  present: T
): { history: History<T>; present: T } | null {
  if (history.past.length === 0) {
    return null;
  }
  const restored = history.past[history.past.length - 1];
  if (restored === undefined) {
    throw new Error('undoHistory: past reported non-zero length but its last entry is missing.');
  }
  return {
    present: restored,
    history: {
      past: history.past.slice(0, -1),
      future: [present, ...history.future],
    },
  };
}

/**
 * Restores the most recently undone snapshot, moving `present` back onto `past`. `null` when
 * `future` is empty — nothing to redo.
 */
export function redoHistory<T>(
  history: History<T>,
  present: T
): { history: History<T>; present: T } | null {
  if (history.future.length === 0) {
    return null;
  }
  const restored = history.future[0];
  if (restored === undefined) {
    throw new Error('redoHistory: future reported non-zero length but its first entry is missing.');
  }
  return {
    present: restored,
    history: {
      past: [...history.past, present],
      future: history.future.slice(1),
    },
  };
}

export function canUndo(history: History<unknown>): boolean {
  return history.past.length > 0;
}

export function canRedo(history: History<unknown>): boolean {
  return history.future.length > 0;
}
