/**
 * The ONE file in `state/` that imports `@/data` (PROJECT.md §5 — state/ is the only layer
 * that talks to localStorage AND the only layer that reaches into the data adapter). Wraps
 * `localJsonSource` with the derived per-format view the store and UI need: an id lookup map
 * and position counts, both memoized so the 426/439-player dataset is only processed once per
 * format, not on every render or every store read.
 */
import { countByPosition, type Format, type Player, type Position } from '@/domain';
import { localJsonSource, type Provenance } from '@/data/sources';

export interface FormatRankings {
  /** Dataset order (ascending baseRank). */
  players: readonly Player[];
  playersById: ReadonlyMap<string, Player>;
  countsByPosition: Record<Position, number>;
  provenance: Provenance;
}

const cache = new Map<Format, FormatRankings>();

function buildRankings(format: Format): FormatRankings {
  const dataset = localJsonSource.load(format);
  const playersById = new Map(dataset.players.map((player) => [player.id, player]));

  return {
    players: dataset.players,
    playersById,
    countsByPosition: countByPosition(dataset.players),
    provenance: dataset.provenance,
  };
}

/** Memoized per format. Backed by `localJsonSource`; swapping the RankingSource happens here. */
export function getRankings(format: Format): FormatRankings {
  const cached = cache.get(format);
  if (cached) {
    return cached;
  }

  const rankings = buildRankings(format);
  cache.set(format, rankings);
  return rankings;
}
