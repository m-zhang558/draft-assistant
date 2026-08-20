/**
 * Reporting for dataset refreshes (MVP 4.12).
 *
 * `reconcileOrder` (`./board`) already silently reconciles a persisted order against a freshly
 * loaded dataset: unknown ids dropped, duplicates collapsed, new players inserted at their
 * `baseRank`. That's necessary on every load, but a silent reconcile is how a dataset refresh
 * eats a note or a watch flag without anyone noticing (phase-4-plan.md §6, 4.12). This module
 * adds the *report* on top, without forking the insertion logic: `reconcileWithReport` calls
 * `reconcileOrder` for the returned order and computes the added/removed/duplicate lists
 * alongside it, so the two can never disagree about what the resulting order actually is. Pure
 * and synchronous — no React, no I/O. See PROJECT.md §5.
 */

import { reconcileOrder } from './board';
import type { Player } from './player';

export interface DatasetRefreshReport {
  /** Dataset players absent from the persisted order, ascending by `baseRank`. */
  added: Player[];
  /** Persisted ids no longer present in the dataset. */
  removed: string[];
  /** Persisted ids that appeared more than once in the persisted order. */
  duplicates: string[];
  /** True iff any of `added`, `removed`, or `duplicates` is non-empty. */
  changed: boolean;
}

/**
 * Reconciles `persistedOrder` against `players` and reports what changed. The returned `order`
 * is exactly what `reconcileOrder(persistedOrder, players)` returns for the same input — this
 * function does not implement a second version of that logic, it calls it directly and computes
 * the report alongside it.
 *
 * A cold start (`persistedOrder` empty) reports `added` = every player and `changed: true`.
 * That is correct: every player genuinely is new relative to an empty persisted order. Deciding
 * not to show a refresh banner for that case is the caller's job, not this function's.
 */
export function reconcileWithReport(
  persistedOrder: readonly string[],
  players: readonly Player[]
): { order: string[]; report: DatasetRefreshReport } {
  const order = reconcileOrder(persistedOrder, players);

  const playersById = new Map(players.map((player) => [player.id, player]));

  const seen = new Set<string>();
  const duplicates: string[] = [];
  const duplicatesSeen = new Set<string>();
  const removed: string[] = [];
  const removedSeen = new Set<string>();
  for (const id of persistedOrder) {
    if (!playersById.has(id)) {
      if (!removedSeen.has(id)) {
        removed.push(id);
        removedSeen.add(id);
      }
      continue;
    }
    if (seen.has(id)) {
      if (!duplicatesSeen.has(id)) {
        duplicates.push(id);
        duplicatesSeen.add(id);
      }
      continue;
    }
    seen.add(id);
  }

  const added = players
    .filter((player) => !seen.has(player.id))
    .slice()
    .sort((a, b) => a.baseRank - b.baseRank);

  const changed = added.length > 0 || removed.length > 0 || duplicates.length > 0;

  return {
    order,
    report: { added, removed, duplicates, changed },
  };
}
