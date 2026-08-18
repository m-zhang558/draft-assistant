/**
 * RankingSource is the ONLY ingestion seam for ranking data (PROJECT.md §3).
 *
 * `load` is synchronous: at runtime the datasets are statically imported JSON bundled at
 * build time, not fetched over the network. The default adapter (`localJsonSource`, see
 * `local-json-source.ts`) reads the checked-in `src/data/rankings/*.json` files. If a
 * licensed API or a user's own export becomes available later, it plugs in here as a new
 * `RankingSource` implementation — nothing else in the app changes.
 */
import type { Format, Player } from '@/domain';

export interface Provenance {
  source: string;
  sourceUrl: string;
  format: Format;
  season: number;
  retrievedAt: string;
  upstreamFormat: string;
  upstreamLastUpdated: string;
  playerCount: number;
  notes: string;
}

export interface RankingDataset {
  format: Format;
  players: readonly Player[];
  provenance: Provenance;
}

export interface RankingSource {
  /** Synchronous: no network I/O happens here. Throws on a malformed dataset. */
  load(format: Format): RankingDataset;
}
