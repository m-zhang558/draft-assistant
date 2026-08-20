/**
 * Positional scarcity aggregation (MVP 4.10): "how many players remain above a value threshold
 * per position", so the insights panel can answer "is it safe to wait on RB?" at a glance.
 *
 * Rankings stay bundled and are joined against `order`/`drafted` in JS rather than in SQL (MVP
 * open question 5) — this is a pure, one-pass aggregation over data already in memory, not a
 * database query. Pure and synchronous — no React, no I/O. See PROJECT.md §5.
 */

import { POSITIONS, type Player, type Position } from './player';

export interface PositionScarcity {
  position: Position;
  /** Undrafted players at this position. */
  remaining: number;
  /**
   * The best (lowest) `tier` value still available at this position, or `null` when no
   * undrafted player at this position carries tier data (e.g. K/DST in redraft — that is data,
   * not an error).
   */
  topTier: number | null;
  /** How many undrafted players share `topTier`. Zero when `topTier` is `null`. */
  remainingInTopTier: number;
  /**
   * The 1-based rank, in the user's `order`, of the best undrafted player at this position.
   * `null` if none remain.
   */
  nextRank: number | null;
}

/**
 * One `PositionScarcity` entry per position in `POSITIONS` order, including positions with zero
 * players in this dataset (dynasty-sf has no K/DST — that position still gets an entry, with
 * `remaining: 0`, rather than being omitted). Walks `order` exactly once, accumulating into all
 * positions' buckets together, rather than re-scanning per position.
 *
 * Throws if an id in `order` is missing from `playersById` — a desynced view is a bug (matches
 * `moveInFilteredView`'s and `visiblePlayers`' posture, not a case to paper over).
 */
export function positionScarcity(
  order: readonly string[],
  playersById: ReadonlyMap<string, Player>,
  drafted: ReadonlySet<string>
): PositionScarcity[] {
  const remaining: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  const topTier: Record<Position, number | null> = {
    QB: null,
    RB: null,
    WR: null,
    TE: null,
    K: null,
    DST: null,
  };
  const remainingInTopTier: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  const nextRank: Record<Position, number | null> = {
    QB: null,
    RB: null,
    WR: null,
    TE: null,
    K: null,
    DST: null,
  };

  order.forEach((id, index) => {
    const player = playersById.get(id);
    if (player === undefined) {
      throw new Error(`positionScarcity: player id "${id}" is not present in playersById.`);
    }
    if (drafted.has(id)) {
      return;
    }

    const { position } = player;
    remaining[position] += 1;

    if (nextRank[position] === null) {
      nextRank[position] = index + 1;
    }

    if (player.tier !== undefined) {
      const currentTop = topTier[position];
      if (currentTop === null || player.tier < currentTop) {
        topTier[position] = player.tier;
        remainingInTopTier[position] = 1;
      } else if (player.tier === currentTop) {
        remainingInTopTier[position] += 1;
      }
    }
  });

  return POSITIONS.map((position) => ({
    position,
    remaining: remaining[position],
    topTier: topTier[position],
    remainingInTopTier: remainingInTopTier[position],
    nextRank: nextRank[position],
  }));
}
