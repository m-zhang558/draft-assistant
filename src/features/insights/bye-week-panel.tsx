/**
 * Bye-week collision panel (MVP 4.11): renders `domain/bye-weeks.ts`'s `byeWeekReport` for the
 * active board's DRAFTED players — grouped by week, flagging positions with 2+ drafted players
 * sharing a bye. See `index.ts` for why this lives in its own `features/insights/` directory.
 *
 * `withoutByeWeek` is always shown as a count, never hidden — `byeWeek` is optional in the
 * dataset (`Player.byeWeek?`, PROJECT.md §5). A board with nothing drafted yet gets an honest
 * empty state ("draft someone to see this") rather than an empty list with no explanation, and a
 * board with drafted players but zero of them sharing a week gets its own "no collisions yet"
 * message distinct from that.
 */
import { byeWeekReport } from '@/domain';
import { activeBoard, getRankings, useBoardStore } from '@/state';

export function ByeWeekPanel() {
  const format = useBoardStore((state) => activeBoard(state).format);
  const drafted = useBoardStore((state) => activeBoard(state).drafted);
  const { playersById } = getRankings(format);

  const report = byeWeekReport(drafted, playersById);

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-text-primary">Bye-week collisions</h3>
      {drafted.size === 0 ? (
        <p className="text-xs text-text-muted">Draft a player to see their bye week here.</p>
      ) : (
        <>
          {report.groups.length === 0 ? (
            <p className="text-xs text-text-muted">
              No bye-week collisions among your drafted players yet.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {report.groups.map((group) => (
                <li key={group.week} className="text-xs">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-text-primary">
                    <span>Week {group.week}</span>
                    {group.collidingPositions.length > 0 ? (
                      <span className="rounded border border-danger px-1.5 py-0.5 text-[10px] font-semibold uppercase text-danger">
                        {group.collidingPositions.join(', ')} stacked
                      </span>
                    ) : null}
                  </div>
                  <p className="text-text-muted">
                    {group.players
                      .map((player) => `${player.name} (${player.position})`)
                      .join(', ')}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {report.withoutByeWeek > 0 ? (
            <p className="mt-2 text-xs text-text-muted">
              {report.withoutByeWeek} drafted player{report.withoutByeWeek === 1 ? '' : 's'} with no
              bye-week data.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
