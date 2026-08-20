import { POSITIONS, type Player } from './player';
import { positionScarcity } from './scarcity';

function player(id: string, position: Player['position'], overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `Player ${id}`,
    position,
    team: 'AAA',
    baseRank: 1,
    ...overrides,
  };
}

describe('positionScarcity', () => {
  it('returns one entry per position in POSITIONS order, even for empty input', () => {
    const result = positionScarcity([], new Map(), new Set());
    expect(result.map((entry) => entry.position)).toEqual([...POSITIONS]);
    for (const entry of result) {
      expect(entry).toEqual({
        position: entry.position,
        remaining: 0,
        topTier: null,
        remainingInTopTier: 0,
        nextRank: null,
      });
    }
  });

  it('returns remaining: 0 for a position with zero players in this dataset (e.g. dynasty-sf K/DST)', () => {
    const players = [player('a', 'QB')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const result = positionScarcity(['a'], playersById, new Set());
    const kEntry = result.find((entry) => entry.position === 'K');
    expect(kEntry).toEqual({
      position: 'K',
      remaining: 0,
      topTier: null,
      remainingInTopTier: 0,
      nextRank: null,
    });
  });

  it('counts only undrafted players as remaining', () => {
    const players = [player('a', 'RB'), player('b', 'RB'), player('c', 'RB')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const drafted = new Set(['b']);
    const result = positionScarcity(['a', 'b', 'c'], playersById, drafted);
    const rb = result.find((entry) => entry.position === 'RB');
    expect(rb?.remaining).toBe(2);
  });

  it('nextRank is the 1-based rank in order of the best undrafted player at that position', () => {
    const players = [player('a', 'QB'), player('b', 'RB'), player('c', 'RB')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    // 'b' is drafted, so the next available RB is 'c' at order index 2 -> rank 3.
    const drafted = new Set(['b']);
    const result = positionScarcity(['a', 'b', 'c'], playersById, drafted);
    const rb = result.find((entry) => entry.position === 'RB');
    expect(rb?.nextRank).toBe(3);
  });

  it('nextRank is null when no undrafted player remains at a position', () => {
    const players = [player('a', 'TE')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const result = positionScarcity(['a'], playersById, new Set(['a']));
    const te = result.find((entry) => entry.position === 'TE');
    expect(te?.nextRank).toBeNull();
  });

  it('topTier is the lowest tier value among undrafted players, and remainingInTopTier counts ties', () => {
    const players = [
      player('a', 'WR', { tier: 2 }),
      player('b', 'WR', { tier: 1 }),
      player('c', 'WR', { tier: 1 }),
      player('d', 'WR', { tier: 3 }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const result = positionScarcity(['a', 'b', 'c', 'd'], playersById, new Set());
    const wr = result.find((entry) => entry.position === 'WR');
    expect(wr?.topTier).toBe(1);
    expect(wr?.remainingInTopTier).toBe(2);
  });

  it('drafting away the entire top tier updates topTier to the next best remaining tier', () => {
    const players = [player('a', 'WR', { tier: 1 }), player('b', 'WR', { tier: 2 })];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const drafted = new Set(['a']);
    const result = positionScarcity(['a', 'b'], playersById, drafted);
    const wr = result.find((entry) => entry.position === 'WR');
    expect(wr?.topTier).toBe(2);
    expect(wr?.remainingInTopTier).toBe(1);
  });

  it('topTier is null and remainingInTopTier is 0 when no undrafted player at the position has tier data (K/DST)', () => {
    const players = [player('a', 'K'), player('b', 'K')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const result = positionScarcity(['a', 'b'], playersById, new Set());
    const k = result.find((entry) => entry.position === 'K');
    expect(k?.topTier).toBeNull();
    expect(k?.remainingInTopTier).toBe(0);
  });

  it('ignores tier-less players when computing topTier alongside tiered players at the same position', () => {
    const players = [player('a', 'DST', { tier: 5 }), player('b', 'DST')];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const result = positionScarcity(['a', 'b'], playersById, new Set());
    const dst = result.find((entry) => entry.position === 'DST');
    expect(dst?.remaining).toBe(2);
    expect(dst?.topTier).toBe(5);
    expect(dst?.remainingInTopTier).toBe(1);
  });

  it('throws when an id in order is missing from playersById', () => {
    expect(() => positionScarcity(['ghost'], new Map(), new Set())).toThrow(/ghost/);
  });

  it('aggregates multiple positions in a single pass correctly', () => {
    const players = [
      player('qb1', 'QB', { tier: 1 }),
      player('rb1', 'RB', { tier: 1 }),
      player('rb2', 'RB', { tier: 2 }),
      player('wr1', 'WR', { tier: 1 }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const order = ['qb1', 'rb1', 'rb2', 'wr1'];
    const result = positionScarcity(order, playersById, new Set());

    const byPosition = new Map(result.map((entry) => [entry.position, entry]));
    expect(byPosition.get('QB')).toEqual({
      position: 'QB',
      remaining: 1,
      topTier: 1,
      remainingInTopTier: 1,
      nextRank: 1,
    });
    expect(byPosition.get('RB')).toEqual({
      position: 'RB',
      remaining: 2,
      topTier: 1,
      remainingInTopTier: 1,
      nextRank: 2,
    });
    expect(byPosition.get('WR')).toEqual({
      position: 'WR',
      remaining: 1,
      topTier: 1,
      remainingInTopTier: 1,
      nextRank: 4,
    });
  });
});
