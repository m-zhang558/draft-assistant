/**
 * Tier band boundaries for the board display.
 *
 * The board renders players in YOUR order (`BoardSlice.order`), not `baseRank` order, so a tier
 * column computed once from the dataset would be wrong the moment a player is dragged across a
 * tier boundary — bands must be recomputed against whatever order is currently on screen. This
 * module does exactly that: it walks a list in display order and reports which player ids sit
 * at the start of a new band, comparing each player only to the one immediately before it. Pure
 * and synchronous — no React, no I/O. See PROJECT.md §5.
 *
 * Rule (deliberate, not incidental): a band starts when `tier` differs from the *immediately
 * previous* player's `tier`, comparing the raw value including `undefined`. Concretely:
 *  - the first player in the list whose `tier` is defined always starts a band;
 *  - a player whose own `tier` is `undefined` never starts a band (there is nothing to render a
 *    boundary for) — 70 of 426 redraft players (the K/DST rows) are exactly this case, and it is
 *    data, not an error;
 *  - `undefined` -> `3` starts a band; `3` -> `undefined` does not, because the transition is
 *    keyed off the current player's own tier, not "did the previous band end".
 */

import type { Player } from './player';

/**
 * The ids of players that start a new tier band, given a list in display order.
 * Empty input returns an empty set.
 */
export function tierStartIds(players: readonly Player[]): Set<string> {
  const starts = new Set<string>();
  let previousTier: number | undefined;

  for (const player of players) {
    if (player.tier !== undefined && player.tier !== previousTier) {
      starts.add(player.id);
    }
    previousTier = player.tier;
  }

  return starts;
}
