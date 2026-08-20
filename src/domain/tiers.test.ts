import type { Player } from './player';
import { customTierNumbers, resolveTierStarts, tierStartIds } from './tiers';

function player(id: string, tier?: number): Player {
  return {
    id,
    name: `Player ${id}`,
    position: 'RB',
    team: 'AAA',
    baseRank: 1,
    ...(tier !== undefined ? { tier } : {}),
  };
}

describe('tierStartIds', () => {
  it('returns an empty set for an empty list', () => {
    expect(tierStartIds([])).toEqual(new Set());
  });

  it('the first player with a defined tier starts a band', () => {
    const players = [player('a', 1), player('b', 1)];
    expect(tierStartIds(players)).toEqual(new Set(['a']));
  });

  it('a later player starts a new band when its tier differs from the previous player', () => {
    const players = [player('a', 1), player('b', 1), player('c', 2)];
    expect(tierStartIds(players)).toEqual(new Set(['a', 'c']));
  });

  it('a player with an undefined tier never starts a band', () => {
    const players = [player('a', undefined), player('b', undefined)];
    expect(tierStartIds(players)).toEqual(new Set());
  });

  it('undefined tier does not break the run for the following defined-tier player: undefined -> 3 starts a band', () => {
    const players = [player('a', undefined), player('b', 3)];
    expect(tierStartIds(players)).toEqual(new Set(['b']));
  });

  it('3 -> undefined does not start a band (the undefined player never starts one)', () => {
    const players = [player('a', 3), player('b', undefined)];
    expect(tierStartIds(players)).toEqual(new Set(['a']));
  });

  it('re-enters the same tier value after a gap and starts a band again (undefined -> 3 always starts)', () => {
    const players = [player('a', 3), player('b', undefined), player('c', 3)];
    expect(tierStartIds(players)).toEqual(new Set(['a', 'c']));
  });

  it('does not start a new band when the tier repeats consecutively', () => {
    const players = [player('a', 1), player('b', 1), player('c', 1)];
    expect(tierStartIds(players)).toEqual(new Set(['a']));
  });

  it('handles reordering that interleaves tiers (board displays your order, not baseRank order)', () => {
    const players = [player('a', 2), player('b', 1), player('c', 2), player('d', 1)];
    expect(tierStartIds(players)).toEqual(new Set(['a', 'b', 'c', 'd']));
  });

  it('handles a realistic K/DST-style run of undefined tiers mixed with defined ones', () => {
    const players = [
      player('a', 1),
      player('b', 1),
      player('k1', undefined),
      player('k2', undefined),
      player('c', 2),
    ];
    expect(tierStartIds(players)).toEqual(new Set(['a', 'c']));
  });
});

describe('resolveTierStarts', () => {
  it('inherits the source tiers when customBreaks is empty', () => {
    const players = [player('a', 1), player('b', 1), player('c', 2)];
    expect(resolveTierStarts(players, new Set())).toEqual(tierStartIds(players));
  });

  it('ignores the source tiers entirely once there is at least one custom break', () => {
    const players = [player('a', 1), player('b', 1), player('c', 2)];
    // Custom break placed on 'b', which the source tiers would NOT mark as a start.
    const result = resolveTierStarts(players, new Set(['b']));
    expect(result).toEqual(new Set(['b']));
  });

  it('intersects customBreaks with ids actually present in players', () => {
    const players = [player('a', 1), player('b', 1)];
    const result = resolveTierStarts(players, new Set(['a', 'retired-player']));
    expect(result).toEqual(new Set(['a']));
  });

  it('a single custom break on an untiered board is honoured even with no source tier data at all', () => {
    const players = [player('a', undefined), player('b', undefined)];
    const result = resolveTierStarts(players, new Set(['a']));
    expect(result).toEqual(new Set(['a']));
  });
});

describe('customTierNumbers', () => {
  it('assigns 1-based band numbers walking display order', () => {
    const players = [player('a'), player('b'), player('c'), player('d')];
    const starts = new Set(['a', 'c']);
    const numbers = customTierNumbers(players, starts);
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(1);
    expect(numbers.get('c')).toBe(2);
    expect(numbers.get('d')).toBe(2);
  });

  it('players before the first start get no entry in the map', () => {
    const players = [player('a'), player('b'), player('c')];
    const starts = new Set(['b']);
    const numbers = customTierNumbers(players, starts);
    expect(numbers.has('a')).toBe(false);
    expect(numbers.get('b')).toBe(1);
    expect(numbers.get('c')).toBe(1);
  });

  it('returns an empty map when starts is empty', () => {
    const players = [player('a'), player('b')];
    expect(customTierNumbers(players, new Set())).toEqual(new Map());
  });

  it('the first player being a start puts them in band 1', () => {
    const players = [player('a'), player('b')];
    const numbers = customTierNumbers(players, new Set(['a']));
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(1);
  });

  it('handles a single-band-then-new-band-then-single-band pattern', () => {
    const players = [player('a'), player('b'), player('c'), player('d'), player('e')];
    const starts = new Set(['a', 'b', 'd']);
    const numbers = customTierNumbers(players, starts);
    expect(numbers.get('a')).toBe(1);
    expect(numbers.get('b')).toBe(2);
    expect(numbers.get('c')).toBe(2);
    expect(numbers.get('d')).toBe(3);
    expect(numbers.get('e')).toBe(3);
  });
});
