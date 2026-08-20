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
 *
 * MVP 4.9 adds custom tiers: the user can mark "start a tier here" on any row. `resolveTierStarts`
 * decides which set of breaks is actually in effect (the source's `tier` field, or the user's own
 * marks — never a mix), and `customTierNumbers` turns a resolved set of breaks into the 1-based
 * band numbers a UI label needs.
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

/**
 * Decides which tier breaks are in effect for a board, given the user's own custom breaks (if
 * any):
 *  - `customBreaks` empty: inherit the source's tiers — returns `tierStartIds(players)`.
 *  - `customBreaks` has 1+ entries: the source's `tier` field is ignored entirely, and the
 *    result is `customBreaks` intersected with the ids actually present in `players` (so a
 *    break on a player who was since removed from the dataset does not linger as a phantom
 *    band).
 *
 * This is deliberately all-or-nothing rather than "custom breaks layered on top of the source's
 * tiers": a half-custom scheme — some boundaries from the source, some drawn by the user — cannot
 * be read at a glance, which is the entire point of tier bands (see the module doc comment). One
 * custom break anywhere on the board means the user has taken over tiering for the whole board.
 */
export function resolveTierStarts(
  players: readonly Player[],
  customBreaks: ReadonlySet<string>
): Set<string> {
  if (customBreaks.size === 0) {
    return tierStartIds(players);
  }

  const presentIds = new Set(players.map((player) => player.id));
  const starts = new Set<string>();
  for (const id of customBreaks) {
    if (presentIds.has(id)) {
      starts.add(id);
    }
  }
  return starts;
}

/**
 * Assigns 1-based band numbers to `orderedPlayers` given a resolved set of band-starting ids
 * (from `resolveTierStarts` or `tierStartIds`), for a UI to label each band ("Tier 1", "Tier 2",
 * ...).
 *
 * Players before the first start have no band yet — they precede band 1 rather than belonging to
 * it, and deliberately get no entry in the returned map (a UI checks `has()` before rendering a
 * label). This is the natural reading of `starts`: a start id marks where a band *begins*, so a
 * player earlier than every marked start cannot be inside any marked band. If `starts` is empty,
 * the returned map is empty — there is nothing to number.
 */
export function customTierNumbers(
  orderedPlayers: readonly Player[],
  starts: ReadonlySet<string>
): Map<string, number> {
  const numbers = new Map<string, number>();
  let currentBand = 0;

  for (const player of orderedPlayers) {
    if (starts.has(player.id)) {
      currentBand += 1;
    }
    if (currentBand > 0) {
      numbers.set(player.id, currentBand);
    }
  }

  return numbers;
}
