/**
 * Fractional ordering keys for the board's persisted display order.
 *
 * SQLite's `board_player.sort_order` is a `REAL` (PROJECT.md §5, phase-4-plan.md §3.2): dragging
 * a player from rank 400 to rank 2 must be exactly one `UPDATE`, not a renumbering of every row
 * in between. The trick is to give the moved row a key that sits between its two new neighbours
 * — `keyBetween` — rather than shifting everyone else's key to make room.
 *
 * That trick has a limit. IEEE-754 doubles have 52 mantissa bits. Repeatedly bisecting the same
 * gap halves it every time, so after `n` successive midpoint splits inside one original gap the
 * gap is `originalGap / 2^n`. A double can represent differences down to roughly
 * `Number.EPSILON * value` before adjacent representable values collide — for values in the
 * thousands (this board's key range, `ORDER_STEP = 1024` times a few hundred players), that
 * collision risk becomes real well before arithmetic underflows to zero. Splitting the same gap
 * ~50 times is the empirical point where consecutive splits stop reliably producing distinct
 * values. `MIN_ORDER_GAP` is set with headroom short of that ceiling — see its own comment — so
 * `needsRenormalisation` fires while there is still comfortable float precision left, never at
 * the edge of collision.
 *
 * `keyBetween` is deliberately dumb: it does not know about the collision ceiling, it just
 * computes a midpoint and throws on nonsense input. `needsRenormalisation` is the guard callers
 * run *before* `keyBetween` to decide whether to renumber the whole board (`renormalise`)
 * instead of splitting further. Keeping the two separate is what makes the adversarial test
 * possible: it proves the guard always fires before the split function could ever produce a key
 * equal to one of its neighbours.
 *
 * Pure and synchronous — no React, no I/O. See PROJECT.md §5.
 */

/** Spacing between neighbouring keys after a fresh `renormalise`. */
export const ORDER_STEP = 1024;

/**
 * The smallest gap between two neighbouring keys that is still safe to bisect with
 * `keyBetween`. Below this, callers must `renormalise` instead of splitting further.
 *
 * Chosen from IEEE-754 reality, not a round number picked for looks: repeatedly halving a gap
 * inside `ORDER_STEP` (1024) survives on the order of ~50 successive midpoint splits before
 * adjacent doubles can no longer represent distinct values reliably (`ORDER_STEP / 2^50` is
 * already below what double subtraction resolves at these magnitudes). `MIN_ORDER_GAP` is set
 * at `2^-20` of `ORDER_STEP` — i.e. renormalisation triggers after ~20 splits of one gap — which
 * leaves a wide 30-split margin of unused precision. That margin matters because
 * `needsRenormalisation` is checked once per drag, not exhaustively, and it must fire long
 * before precision runs out, not exactly when it does.
 */
export const MIN_ORDER_GAP = ORDER_STEP / 2 ** 20;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number; got ${value}.`);
  }
}

/**
 * The key to give a player inserted between `before` and `after` (both exclusive), where either
 * end may be `null` to mean "no neighbour there":
 *  - `before === null && after === null`: the board is empty. Returns `ORDER_STEP`.
 *  - `before === null`: insert at the head. Returns `after - ORDER_STEP`.
 *  - `after === null`: append at the tail. Returns `before + ORDER_STEP`.
 *  - both given: returns the midpoint `(before + after) / 2`.
 *
 * Throws `RangeError` if either argument is a non-finite number, or if `before >= after` — an
 * inverted or equal pair is a caller bug (a desynced neighbour lookup), not something to paper
 * over silently.
 */
export function keyBetween(before: number | null, after: number | null): number {
  if (before !== null) {
    assertFinite(before, 'keyBetween: before');
  }
  if (after !== null) {
    assertFinite(after, 'keyBetween: after');
  }

  if (before === null && after === null) {
    return ORDER_STEP;
  }
  if (before === null) {
    // after is not null here (both-null handled above).
    return (after as number) - ORDER_STEP;
  }
  if (after === null) {
    return before + ORDER_STEP;
  }

  if (before >= after) {
    throw new RangeError(
      `keyBetween: before (${before}) must be strictly less than after (${after}).`
    );
  }

  return before + (after - before) / 2;
}

/**
 * True when the gap between two neighbours is at or below `MIN_ORDER_GAP` — the point at which
 * `keyBetween` should no longer be trusted to split it, and the caller must `renormalise`
 * instead. `null` on either side (head/tail/empty) always has room, since `keyBetween` steps by
 * a full `ORDER_STEP` in that case.
 */
export function needsRenormalisation(before: number | null, after: number | null): boolean {
  if (before === null || after === null) {
    return false;
  }
  return after - before <= MIN_ORDER_GAP;
}

/**
 * Evenly re-spaces every id's key to `ORDER_STEP, 2 * ORDER_STEP, ...` in the given order,
 * restoring full room for future `keyBetween` splits. Throws on a duplicate id — a caller
 * passing the same id twice has a desynced order, which is a bug.
 */
export function renormalise(orderedIds: readonly string[]): Map<string, number> {
  const keys = new Map<string, number>();
  orderedIds.forEach((id, index) => {
    if (keys.has(id)) {
      throw new Error(`renormalise: duplicate player id "${id}" in orderedIds.`);
    }
    keys.set(id, ORDER_STEP * (index + 1));
  });
  return keys;
}

/**
 * Assigns the first-ever set of sort keys for a freshly seeded board. Identical to
 * `renormalise` — kept as a separate export so call sites read "seed a new board" vs
 * "repair an existing one" without duplicating the body.
 */
export const initialSortKeys = renormalise;

/**
 * Recovers display order from a map of id -> key, ascending by key. Ties (which should not
 * occur under correct use of `keyBetween`/`needsRenormalisation`, but a defensive read must
 * still be deterministic) are broken by id so the result never depends on `Map` iteration order.
 */
export function sortIdsByKey(keys: ReadonlyMap<string, number>): string[] {
  return [...keys.entries()]
    .sort(([idA, keyA], [idB, keyB]) => {
      if (keyA !== keyB) {
        return keyA - keyB;
      }
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map(([id]) => id);
}
