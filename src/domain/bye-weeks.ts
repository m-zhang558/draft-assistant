/**
 * Bye-week collision reporting among the user's drafted players (MVP 4.11): "which weeks am I
 * light on players, and at which positions does that bite hardest?"
 *
 * `byeWeek` is optional in the dataset (PROJECT.md §5, `Player.byeWeek?`) — a player without one
 * is reported as a count (`withoutByeWeek`), never silently dropped from the report. Pure and
 * synchronous — no React, no I/O. See PROJECT.md §5.
 *
 * Asymmetry with `order`-consuming functions like `visiblePlayers`/`positionScarcity`: those
 * throw when an id is missing from `playersById`, because `order` is reconciled against the
 * dataset on every load and is never supposed to reference a player that isn't there. `drafted`
 * has no such guarantee — it can legitimately outlive a dataset refresh (MVP 4.12): a player
 * dropped from a refreshed dataset stays in `drafted` (the user really did draft them) even
 * though they're no longer in `playersById`. So `byeWeekReport` ignores drafted ids absent from
 * `playersById` instead of throwing.
 */

import { POSITIONS, type Player, type Position } from './player';

export interface ByeWeekGroup {
  week: number;
  /** Drafted players on this bye week, ordered by `baseRank`. */
  players: Player[];
  /** Positions with 2 or more drafted players sharing this bye week. */
  collidingPositions: Position[];
}

export interface ByeWeekReport {
  /** Ascending by week. */
  groups: ByeWeekGroup[];
  /** Count of drafted players whose `byeWeek` is undefined. */
  withoutByeWeek: number;
}

export function byeWeekReport(
  drafted: ReadonlySet<string>,
  playersById: ReadonlyMap<string, Player>
): ByeWeekReport {
  const byWeek = new Map<number, Player[]>();
  let withoutByeWeek = 0;

  for (const id of drafted) {
    const player = playersById.get(id);
    if (player === undefined) {
      // Drafted ids can legitimately outlive a dataset refresh — see the module doc comment.
      continue;
    }
    if (player.byeWeek === undefined) {
      withoutByeWeek += 1;
      continue;
    }
    const group = byWeek.get(player.byeWeek);
    if (group === undefined) {
      byWeek.set(player.byeWeek, [player]);
    } else {
      group.push(player);
    }
  }

  const groups: ByeWeekGroup[] = [...byWeek.entries()]
    .sort(([weekA], [weekB]) => weekA - weekB)
    .map(([week, players]) => {
      const sortedPlayers = [...players].sort((a, b) => a.baseRank - b.baseRank);

      const countByPosition = new Map<Position, number>();
      for (const player of sortedPlayers) {
        countByPosition.set(player.position, (countByPosition.get(player.position) ?? 0) + 1);
      }
      // Filtered against POSITIONS (rather than Map iteration order) so collidingPositions is
      // always in the same deterministic display order used everywhere else in the domain.
      const collidingPositions = POSITIONS.filter(
        (position) => (countByPosition.get(position) ?? 0) >= 2
      );

      return { week, players: sortedPlayers, collidingPositions };
    });

  return { groups, withoutByeWeek };
}
