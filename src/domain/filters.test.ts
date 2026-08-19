import type { Player, Position } from './player';
import { POSITIONS } from './player';
import {
  POSITION_FILTER_ALL,
  countByPosition,
  matchesAvailability,
  matchesPosition,
  matchesSearch,
  visiblePlayers,
} from './filters';
import type { FilterCriteria } from './filters';

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

function criteria(overrides: Partial<FilterCriteria> = {}): FilterCriteria {
  return {
    position: POSITION_FILTER_ALL,
    search: '',
    availableOnly: false,
    ...overrides,
  };
}

describe('matchesPosition', () => {
  it('matches everything when filter is ALL', () => {
    expect(matchesPosition(player('a', { position: 'QB' }), POSITION_FILTER_ALL)).toBe(true);
    expect(matchesPosition(player('a', { position: 'DST' }), POSITION_FILTER_ALL)).toBe(true);
  });

  it('matches only the given position otherwise', () => {
    const wr = player('a', { position: 'WR' });
    expect(matchesPosition(wr, 'WR')).toBe(true);
    expect(matchesPosition(wr, 'RB')).toBe(false);
  });
});

describe('matchesSearch', () => {
  it('is case-insensitive on name', () => {
    const p = player('a', { name: 'Ja’Marr Chase' });
    expect(matchesSearch(p, 'chase')).toBe(true);
    expect(matchesSearch(p, 'CHASE')).toBe(true);
  });

  it('matches on team as well as name', () => {
    const p = player('a', { name: 'Someone Nobody', team: 'KC' });
    expect(matchesSearch(p, 'kc')).toBe(true);
  });

  it('supports substring matches, not just prefixes', () => {
    const p = player('a', { name: 'Christian McCaffrey' });
    expect(matchesSearch(p, 'caffrey')).toBe(true);
  });

  it('rejects a query matching neither name nor team', () => {
    const p = player('a', { name: 'Someone', team: 'KC' });
    expect(matchesSearch(p, 'zzz')).toBe(false);
  });

  it('treats an empty or whitespace-only query as matching everything', () => {
    const p = player('a');
    expect(matchesSearch(p, '')).toBe(true);
    expect(matchesSearch(p, '   ')).toBe(true);
  });
});

describe('matchesAvailability', () => {
  it('matches every player when availableOnly is false, drafted or not', () => {
    const drafted = new Set(['a']);
    expect(matchesAvailability('a', drafted, false)).toBe(true);
    expect(matchesAvailability('b', drafted, false)).toBe(true);
  });

  it('excludes drafted players when availableOnly is true', () => {
    const drafted = new Set(['a']);
    expect(matchesAvailability('a', drafted, true)).toBe(false);
    expect(matchesAvailability('b', drafted, true)).toBe(true);
  });
});

describe('visiblePlayers', () => {
  it('composes all three predicates', () => {
    const players = [
      player('a', { name: 'Alpha', position: 'QB', team: 'AAA', baseRank: 1 }),
      player('b', { name: 'Bravo', position: 'RB', team: 'BBB', baseRank: 2 }),
      player('c', { name: 'Charlie', position: 'QB', team: 'CCC', baseRank: 3 }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));
    const drafted = new Set(['a']);

    const result = visiblePlayers(
      ['a', 'b', 'c'],
      playersById,
      drafted,
      criteria({ position: 'QB', availableOnly: true })
    );

    // 'a' is QB but drafted (excluded by availableOnly); 'b' is not a QB (excluded by
    // position); only 'c' passes all three predicates.
    expect(result.map((p) => p.id)).toEqual(['c']);
  });

  it('preserves the given order, not baseRank order', () => {
    const players = [
      player('a', { baseRank: 1 }),
      player('b', { baseRank: 2 }),
      player('c', { baseRank: 3 }),
    ];
    const playersById = new Map(players.map((p) => [p.id, p]));

    // Custom order puts the highest baseRank first.
    const result = visiblePlayers(['c', 'a', 'b'], playersById, new Set(), criteria());

    expect(result.map((p) => p.id)).toEqual(['c', 'a', 'b']);
  });

  it('throws, naming the id, when an id in order is missing from playersById', () => {
    const playersById = new Map<string, Player>([['a', player('a')]]);
    expect(() => visiblePlayers(['a', 'zzz'], playersById, new Set(), criteria())).toThrow(/zzz/);
  });
});

describe('countByPosition', () => {
  it('has every Position key present, even at zero', () => {
    const counts = countByPosition([]);
    for (const position of POSITIONS) {
      expect(counts[position]).toBe(0);
    }
  });

  it('counts players per position and leaves absent positions at zero', () => {
    const players = [
      player('a', { position: 'QB' }),
      player('b', { position: 'QB' }),
      player('c', { position: 'RB' }),
    ];
    const counts = countByPosition(players);

    const expected: Record<Position, number> = { QB: 2, RB: 1, WR: 0, TE: 0, K: 0, DST: 0 };
    expect(counts).toEqual(expected);
  });

  it('represents a format with genuinely zero K and DST (Dynasty Superflex)', () => {
    const players = [
      player('a', { position: 'QB' }),
      player('b', { position: 'RB' }),
      player('c', { position: 'WR' }),
      player('d', { position: 'TE' }),
    ];
    const counts = countByPosition(players);
    expect(counts.K).toBe(0);
    expect(counts.DST).toBe(0);
    expect(Object.keys(counts)).toHaveLength(POSITIONS.length);
  });
});
