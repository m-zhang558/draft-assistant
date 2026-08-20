/**
 * Positional scarcity panel (MVP 4.10): renders `domain/scarcity.ts`'s `positionScarcity` for
 * the active board — per position, how many undrafted players remain, how many share the
 * current top tier, and the board rank of the next available player. See `index.ts` for why this
 * lives in its own `features/insights/` directory rather than inside `features/board/`.
 *
 * Zero-player positions are DATA, not a load failure: dynasty-sf ranks no K or DST at all
 * (PROJECT.md §3). `positionScarcity` cannot distinguish "this format ranks nobody here" from
 * "everybody here has been drafted" — both produce `remaining: 0` — so this component reads the
 * format's own `countsByPosition` (the same source `filters/position-tabs.tsx` uses to disable a
 * tab) to tell them apart, and renders the former as an honest "not ranked in this format" row
 * rather than a silently-hidden one or a "0 remaining" that would misread as "all drafted".
 * `topTier === null` (redraft K/DST, which the source ranks but never tiers) is rendered as
 * "no tier data", never as tier 0.
 *
 * Clicking a ranked position filters the board to it (`setPosition`) — the actual mid-draft use
 * ("who's the best RB left?").
 */
import { positionScarcity } from '@/domain';
import { activeBoard, getRankings, useBoardStore } from '@/state';

export function ScarcityPanel() {
  const format = useBoardStore((state) => activeBoard(state).format);
  const order = useBoardStore((state) => activeBoard(state).order);
  const drafted = useBoardStore((state) => activeBoard(state).drafted);

  const { playersById, countsByPosition } = getRankings(format);
  const rows = positionScarcity(order, playersById, drafted);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">Positional scarcity</h3>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => {
          const rankedInFormat = countsByPosition[row.position] > 0;

          if (!rankedInFormat) {
            return (
              <li
                key={row.position}
                className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-text-muted"
              >
                <span className="font-medium">{row.position}</span>
                <span>Not ranked in this format</span>
              </li>
            );
          }

          return (
            <li key={row.position}>
              <button
                type="button"
                onClick={() => useBoardStore.getState().setPosition(row.position)}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-left text-xs hover:bg-surface-muted"
              >
                <span className="font-medium text-text-primary">{row.position}</span>
                <span className="text-text-muted">
                  {row.remaining} left
                  {row.topTier !== null
                    ? ` · ${row.remainingInTopTier} in tier ${row.topTier}`
                    : ' · no tier data'}
                  {row.nextRank !== null ? ` · next #${row.nextRank}` : ' · none left'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
