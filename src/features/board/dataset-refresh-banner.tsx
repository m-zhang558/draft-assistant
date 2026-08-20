/**
 * Dataset-refresh banner (MVP 4.12): reads `datasetReports[activeBoardId]` (populated once at
 * boot by `initialiseBoardStore`'s reconciliation against the current dataset,
 * `domain/dataset-refresh.ts`) and — when the active board's report is genuinely `changed` —
 * names exactly what happened: how many players were added (inserted at their `baseRank`), how
 * many were removed, and that removed players took their notes, watchlist flags, and custom tier
 * breaks with them. A silent reconcile eating a note is exactly the failure this item exists to
 * prevent (`docs/plans/phase-4-plan.md` §6, 4.12).
 *
 * --- Cold start never produces a banner, and needs no extra flag to say so ---
 *
 * A cold start (or a first-run legacy-`localStorage` migration) seeds every board from
 * `initialOrder`/`reconcileOrder` against the CURRENT dataset (`state/migrate-local-storage.ts`'s
 * `buildSeedBoardCommand`) — the very same dataset `initialiseBoardStore` then reconciles that
 * freshly-seeded board against, a moment later. Reconciling an already-reconciled order against
 * the same dataset is a no-op (`domain/board.ts`'s `reconcileOrder` is idempotent: every dataset
 * player is already present exactly once, in order), so `report.changed` is structurally `false`
 * for every board on a cold start or a migration. `changed: true` can therefore only happen on a
 * WARM boot — rows already persisted from an earlier session, reconciled against a dataset that
 * has since changed underneath them (a real `npm run fetch:rankings` regeneration). This
 * component needs no separate "was this a cold start" flag as a result: `report.changed` alone
 * already answers it, verified by `dataset-refresh-banner.test.tsx`.
 *
 * Dismissal is per session, per board (`dismissedBoardIds`, local component state) — never
 * persisted, since `datasetReports` itself is not persisted either (`board-store.ts`'s file
 * header).
 */
import { useState } from 'react';
import { activeBoard, useBoardStore } from '@/state';
import { Button } from '@/ui';

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function DatasetRefreshBanner() {
  const boardId = useBoardStore((state) => state.activeBoardId);
  const boardName = useBoardStore((state) => activeBoard(state).name);
  const report = useBoardStore((state) => state.datasetReports[state.activeBoardId]);
  const [dismissedBoardIds, setDismissedBoardIds] = useState<ReadonlySet<string>>(new Set());

  if (!report || !report.changed || dismissedBoardIds.has(boardId)) {
    return null;
  }

  const parts: string[] = [];
  if (report.added.length > 0) {
    parts.push(`${pluralize(report.added.length, 'player')} added`);
  }
  if (report.removed.length > 0) {
    parts.push(
      `${pluralize(report.removed.length, 'player')} removed — their notes, watchlist flags, ` +
        'and custom tier breaks were removed with them'
    );
  }
  if (report.duplicates.length > 0) {
    parts.push(`${pluralize(report.duplicates.length, 'duplicate entry')} collapsed`);
  }

  function dismiss() {
    setDismissedBoardIds((previous) => new Set(previous).add(boardId));
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm text-text-primary">
      <span>
        The rankings behind {boardName} changed since you last opened it: {parts.join('; ')}.
      </span>
      <Button variant="ghost" size="sm" onClick={dismiss}>
        Dismiss
      </Button>
    </div>
  );
}
