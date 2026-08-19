import type { Player } from './player';
import { tierStartIds } from './tiers';

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
