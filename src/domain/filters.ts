/**
 * Position / search / availability predicates, and the derived "visible players" view used
 * to render the board. Pure and synchronous — no React, no I/O. See PROJECT.md §5.
 */

import type { Player, Position } from './player';

export const POSITION_FILTER_ALL = 'ALL';

export type PositionFilter = Position | typeof POSITION_FILTER_ALL;

export interface FilterCriteria {
  position: PositionFilter;
  search: string;
  availableOnly: boolean;
}

export function matchesPosition(player: Player, filter: PositionFilter): boolean {
  return filter === POSITION_FILTER_ALL || player.position === filter;
}

/** Case-insensitive substring match on name OR team. Empty/whitespace-only query matches all. */
export function matchesSearch(player: Player, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === '') {
    return true;
  }
  return player.name.toLowerCase().includes(needle) || player.team.toLowerCase().includes(needle);
}

export function matchesAvailability(
  playerId: string,
  drafted: ReadonlySet<string>,
  availableOnly: boolean
): boolean {
  return !availableOnly || !drafted.has(playerId);
}

/**
 * Walks `order`, resolves each id through `playersById`, and returns the players passing all
 * three predicates — in YOUR order. Throws an Error naming the id if it is not in `playersById`.
 */
export function visiblePlayers(
  order: readonly string[],
  playersById: ReadonlyMap<string, Player>,
  drafted: ReadonlySet<string>,
  criteria: FilterCriteria
): Player[] {
  const result: Player[] = [];
  for (const id of order) {
    const player = playersById.get(id);
    if (player === undefined) {
      throw new Error(`visiblePlayers: player id "${id}" is not present in playersById.`);
    }
    if (
      matchesPosition(player, criteria.position) &&
      matchesSearch(player, criteria.search) &&
      matchesAvailability(id, drafted, criteria.availableOnly)
    ) {
      result.push(player);
    }
  }
  return result;
}

/** Count per position across the dataset. Every Position key present, zero when absent. */
export function countByPosition(players: readonly Player[]): Record<Position, number> {
  const counts: Record<Position, number> = { QB: 0, RB: 0, WR: 0, TE: 0, K: 0, DST: 0 };
  for (const player of players) {
    counts[player.position] += 1;
  }
  return counts;
}
