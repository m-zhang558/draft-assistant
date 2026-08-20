import { byeWeekReport } from './bye-weeks';
import type { Player } from './player';

function player(id: string, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `Player ${id}`,
    position: 'RB',
    team: 'AAA',
    baseRank: 1,
    ...overrides,
  };
}

describe('byeWeekReport', () => {
  it('returns empty groups and zero withoutByeWeek for no drafted players', () => {
    expect(byeWeekReport(new Set(), new Map())).toEqual({ groups: [], withoutByeWeek: 0 });
  });

  it('groups drafted players by week', () => {
    const players = [player('a', { byeWeek: 7 }), player('b', { byeWeek: 9 })];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['a', 'b']), playersById);
    expect(report.groups.map((g) => g.week)).toEqual([7, 9]);
    expect(report.groups[0]?.players.map((p) => p.id)).toEqual(['a']);
  });

  it('groups are sorted ascending by week regardless of drafted set iteration order', () => {
    const players = [
      player('a', { byeWeek: 12 }),
      player('b', { byeWeek: 5 }),
      player('c', { byeWeek: 8 }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['a', 'b', 'c']), playersById);
    expect(report.groups.map((g) => g.week)).toEqual([5, 8, 12]);
  });

  it('players within a group are ordered by baseRank', () => {
    const players = [
      player('hi-rank', { byeWeek: 7, baseRank: 50 }),
      player('lo-rank', { byeWeek: 7, baseRank: 5 }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['hi-rank', 'lo-rank']), playersById);
    expect(report.groups[0]?.players.map((p) => p.id)).toEqual(['lo-rank', 'hi-rank']);
  });

  it('counts drafted players without a byeWeek instead of hiding them', () => {
    const players = [player('a', { byeWeek: 7 }), player('b'), player('c')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['a', 'b', 'c']), playersById);
    expect(report.withoutByeWeek).toBe(2);
    expect(report.groups).toHaveLength(1);
  });

  it('flags a position with 2+ drafted players sharing a bye week as colliding', () => {
    const players = [
      player('rb1', { byeWeek: 7, position: 'RB' }),
      player('rb2', { byeWeek: 7, position: 'RB' }),
      player('wr1', { byeWeek: 7, position: 'WR' }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['rb1', 'rb2', 'wr1']), playersById);
    expect(report.groups[0]?.collidingPositions).toEqual(['RB']);
  });

  it('does not flag a position with only 1 drafted player on that bye week', () => {
    const players = [player('rb1', { byeWeek: 7, position: 'RB' })];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['rb1']), playersById);
    expect(report.groups[0]?.collidingPositions).toEqual([]);
  });

  it('collidingPositions is ordered following the POSITIONS display order, not insertion order', () => {
    const players = [
      player('wr1', { byeWeek: 7, position: 'WR' }),
      player('wr2', { byeWeek: 7, position: 'WR' }),
      player('rb1', { byeWeek: 7, position: 'RB' }),
      player('rb2', { byeWeek: 7, position: 'RB' }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['wr1', 'wr2', 'rb1', 'rb2']), playersById);
    expect(report.groups[0]?.collidingPositions).toEqual(['RB', 'WR']);
  });

  it('ignores drafted ids absent from playersById instead of throwing (asymmetric with order-based functions)', () => {
    const players = [player('a', { byeWeek: 7 })];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const report = byeWeekReport(new Set(['a', 'retired-player']), playersById);
    expect(report.groups[0]?.players.map((p) => p.id)).toEqual(['a']);
    expect(report.withoutByeWeek).toBe(0);
  });
});
