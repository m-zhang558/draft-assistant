/**
 * Board reordering, reconciliation, and rank-delta logic for Fantasy Assist.
 *
 * `order` is the single source of truth for "your ranking": an array of player ids that
 * starts out in baseRank order and is customized by dragging. This module keeps that array
 * consistent when the underlying dataset changes (`reconcileOrder`) and when the user drags
 * within a filtered view (`moveInFilteredView`), and derives rank / rank-delta from it. Pure
 * and synchronous — no React, no I/O. See PROJECT.md §5.
 */

import type { Player } from './player';

/** All player ids sorted by baseRank ascending. */
export function initialOrder(players: readonly Player[]): string[] {
  return [...players].sort((a, b) => a.baseRank - b.baseRank).map((player) => player.id);
}

/**
 * Reconciles a persisted order against the currently loaded dataset.
 *  - ids in `persistedOrder` that are not in `players` are dropped
 *  - duplicate ids collapse to their first occurrence
 *  - players in `players` missing from the order are inserted (in ascending baseRank order)
 *    before the first player already in the order whose baseRank is greater; appended if none
 */
export function reconcileOrder(
  persistedOrder: readonly string[],
  players: readonly Player[]
): string[] {
  const playersById = new Map(players.map((player) => [player.id, player]));

  const seen = new Set<string>();
  const result: Player[] = [];
  for (const id of persistedOrder) {
    const player = playersById.get(id);
    if (player === undefined || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(player);
  }

  const missing = players
    .filter((player) => !seen.has(player.id))
    .slice()
    .sort((a, b) => a.baseRank - b.baseRank);

  for (const player of missing) {
    const insertAt = result.findIndex((existing) => existing.baseRank > player.baseRank);
    if (insertAt === -1) {
      result.push(player);
    } else {
      result.splice(insertAt, 0, player);
    }
  }

  return result.map((player) => player.id);
}

/**
 * Moves the visible item at `fromIndex` to `toIndex` WITHIN the filtered view and writes the
 * result back into the full order. Players not in `visibleIds` never change position.
 *
 * Implementation: take the full-order slots occupied by `visibleIds`, reorder `visibleIds`,
 * write them back into those same slots in the new order.
 *
 * Throws RangeError if an index is out of bounds for `visibleIds`, or if `visibleIds` is not a
 * subset of `order`, or if `visibleIds` is not in the same relative order as it appears in
 * `order`. (Fail fast — a desynced view is a bug, not something to paper over.)
 */
export function moveInFilteredView(
  order: readonly string[],
  visibleIds: readonly string[],
  fromIndex: number,
  toIndex: number
): string[] {
  if (
    !Number.isInteger(fromIndex) ||
    fromIndex < 0 ||
    fromIndex >= visibleIds.length ||
    !Number.isInteger(toIndex) ||
    toIndex < 0 ||
    toIndex >= visibleIds.length
  ) {
    throw new RangeError(
      `moveInFilteredView: fromIndex (${fromIndex}) and toIndex (${toIndex}) must both be ` +
        `valid indices into visibleIds (length ${visibleIds.length}).`
    );
  }

  const positionInOrder = new Map<string, number>();
  order.forEach((id, index) => positionInOrder.set(id, index));

  const slots: number[] = [];
  let previousSlot = -1;
  for (const id of visibleIds) {
    const slot = positionInOrder.get(id);
    if (slot === undefined) {
      throw new RangeError(`moveInFilteredView: visible id "${id}" is not present in order.`);
    }
    if (slot <= previousSlot) {
      throw new RangeError(
        `moveInFilteredView: visibleIds must appear in the same relative order as order; ` +
          `"${id}" is out of order.`
      );
    }
    previousSlot = slot;
    slots.push(slot);
  }

  if (fromIndex === toIndex) {
    return [...order];
  }

  const reordered = [...visibleIds];
  const removed = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, ...removed);

  const slotSet = new Set(slots);
  const queue = [...reordered];
  return order.map((id, index) => {
    if (!slotSet.has(index)) {
      return id;
    }
    const next = queue.shift();
    if (next === undefined) {
      throw new Error('moveInFilteredView: ran out of reordered ids while rebuilding order.');
    }
    return next;
  });
}

/**
 * Translates a drag-and-drop gesture ("the user dropped player `activeId` onto player
 * `overId`") into the index pair that `moveInFilteredView` expects.
 *
 * Returns `null` for the two legitimate no-ops: dropped outside the list (`overId === null`)
 * and dropped back onto itself. Throws when an id is not in `visibleIds` — that is a desynced
 * view, i.e. a bug, and silently ignoring it would move nothing while looking like it worked.
 */
export function resolveDragMove(
  visibleIds: readonly string[],
  activeId: string,
  overId: string | null
): { fromIndex: number; toIndex: number } | null {
  if (overId === null) {
    return null;
  }
  if (activeId === overId) {
    return null;
  }

  const fromIndex = visibleIds.indexOf(activeId);
  if (fromIndex === -1) {
    throw new Error(`resolveDragMove: active id "${activeId}" is not present in visibleIds.`);
  }

  const toIndex = visibleIds.indexOf(overId);
  if (toIndex === -1) {
    throw new Error(`resolveDragMove: over id "${overId}" is not present in visibleIds.`);
  }

  return { fromIndex, toIndex };
}

/** player id -> 1-based rank within `order`. Throws on a duplicate id. */
export function rankIndex(order: readonly string[]): Map<string, number> {
  const index = new Map<string, number>();
  order.forEach((id, i) => {
    if (index.has(id)) {
      throw new Error(`rankIndex: duplicate player id "${id}" in order.`);
    }
    index.set(id, i + 1);
  });
  return index;
}

/** baseRank - yourRank. Positive = you promoted them, negative = you demoted them, 0 = unmoved. */
export function rankDelta(yourRank: number, baseRank: number): number {
  return baseRank - yourRank;
}
