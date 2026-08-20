/**
 * Board metadata for Fantasy Assist's multiple-named-boards feature (MVP 4.6).
 *
 * A "board" is no longer just "the redraft board" or "the dynasty board" — the user can create,
 * rename, duplicate, and delete several boards of the same format. This module holds the pure
 * pieces of that: the shape of a board's metadata, name validation/normalisation, and the
 * "duplicate board" naming scheme. It deliberately does NOT generate ids or timestamps itself
 * (see `createBoardMeta`) so it stays pure and testable — `state/` supplies `crypto.randomUUID()`
 * and `new Date().toISOString()` at the call site. Pure and synchronous — no React, no I/O. See
 * PROJECT.md §5.
 */

import { isFormat, type Format } from './player';

export interface BoardMeta {
  id: string;
  name: string;
  format: Format;
  createdAt: string;
}

/** A board name longer than this is rejected by `validateBoardName`. */
export const MAX_BOARD_NAME_LENGTH = 60;

/** Trims leading/trailing whitespace and collapses internal runs of whitespace to one space. */
export function normaliseBoardName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Returns the normalised name, or throws an `Error` naming the problem when the result is
 * empty or exceeds `MAX_BOARD_NAME_LENGTH`. The UI is expected to validate before ever calling
 * this — this is the invariant guard for anything that reaches the store (import, a bug in that
 * UI validation, etc.), not the primary user-facing validation message.
 */
export function validateBoardName(raw: string): string {
  const normalised = normaliseBoardName(raw);
  if (normalised.length === 0) {
    throw new Error('validateBoardName: board name cannot be empty.');
  }
  if (normalised.length > MAX_BOARD_NAME_LENGTH) {
    throw new Error(
      `validateBoardName: board name "${normalised}" exceeds the ${MAX_BOARD_NAME_LENGTH}-character limit.`
    );
  }
  return normalised;
}

/**
 * The name to give a duplicate of `base`, avoiding a collision with any of `existingNames`:
 * `"Redraft PPR"` -> `"Redraft PPR (2)"`, and if that's also taken, `"Redraft PPR (3)"`, and so
 * on. `existingNames` is matched exactly (case-sensitive) — callers pass the set of names
 * already on the board list.
 */
export function nextBoardName(existingNames: readonly string[], base: string): string {
  const taken = new Set(existingNames);
  if (!taken.has(base)) {
    return base;
  }
  let suffix = 2;
  let candidate = `${base} (${suffix})`;
  while (taken.has(candidate)) {
    suffix += 1;
    candidate = `${base} (${suffix})`;
  }
  return candidate;
}

/**
 * Constructs a `BoardMeta`. Takes `id` and `createdAt` as arguments rather than generating them
 * internally (`crypto.randomUUID()`, `new Date().toISOString()`) so this stays a pure,
 * deterministic function — the caller in `state/` supplies both.
 */
export function createBoardMeta(
  id: string,
  name: string,
  format: Format,
  createdAt: string
): BoardMeta {
  return { id, name, format, createdAt };
}

/** Narrows an unknown value to a valid {@link BoardMeta}, e.g. when validating imported data. */
export function isBoardMeta(value: unknown): value is BoardMeta {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    isFormat(candidate.format) &&
    typeof candidate.createdAt === 'string'
  );
}
