/**
 * Read-only static render of a ranked player list (Phase 1, item 1.7).
 *
 * Presentational only: no reordering, no cross-off, no filtering. Those arrive in Phase 2
 * behind a Zustand store; this component just renders whatever `players` it is given, in
 * the order given, as an accessible table.
 */
import type { Player } from '@/domain';

export interface PlayerListProps {
  players: readonly Player[];
}

export function PlayerList({ players }: PlayerListProps) {
  return (
    <table className="w-full border-collapse text-left text-sm">
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Rank
          </th>
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Name
          </th>
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Pos
          </th>
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Team
          </th>
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Tier
          </th>
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Bye
          </th>
          <th scope="col" className="px-3 py-2 font-medium text-text-muted">
            Age
          </th>
        </tr>
      </thead>
      <tbody>
        {players.map((player) => (
          <tr key={player.id} className="border-b border-border text-text-primary">
            <td className="px-3 py-2">{player.baseRank}</td>
            <td className="px-3 py-2">{player.name}</td>
            <td className="px-3 py-2">{player.position}</td>
            <td className="px-3 py-2">{player.team}</td>
            <td className="px-3 py-2">{player.tier ?? ''}</td>
            <td className="px-3 py-2">{player.byeWeek ?? ''}</td>
            <td className="px-3 py-2">{player.age ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
