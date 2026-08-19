import { getRankings } from './rankings';

describe('getRankings', () => {
  it('loads redraft-ppr with the documented position counts (PROJECT.md §3)', () => {
    const rankings = getRankings('redraft-ppr');

    expect(rankings.players).toHaveLength(426);
    expect(rankings.countsByPosition).toEqual({
      QB: 49,
      RB: 104,
      WR: 146,
      TE: 57,
      K: 38,
      DST: 32,
    });
  });

  it('loads dynasty-sf with the documented position counts, zero K and DST (PROJECT.md §3)', () => {
    const rankings = getRankings('dynasty-sf');

    expect(rankings.players).toHaveLength(439);
    expect(rankings.countsByPosition).toEqual({
      QB: 68,
      RB: 124,
      WR: 174,
      TE: 73,
      K: 0,
      DST: 0,
    });
  });

  it('builds a playersById map with one entry per player, no duplicates or drops', () => {
    const rankings = getRankings('redraft-ppr');

    expect(rankings.playersById.size).toBe(rankings.players.length);
    for (const player of rankings.players) {
      expect(rankings.playersById.get(player.id)).toEqual(player);
    }
  });

  it('carries the dataset provenance through', () => {
    const rankings = getRankings('redraft-ppr');

    expect(rankings.provenance.format).toBe('redraft-ppr');
    expect(rankings.provenance.playerCount).toBe(426);
  });

  it('is memoized per format: the same object reference is returned on a second call', () => {
    const first = getRankings('dynasty-sf');
    const second = getRankings('dynasty-sf');

    expect(second).toBe(first);
    expect(second.playersById).toBe(first.playersById);
  });

  it('memoizes redraft-ppr and dynasty-sf independently', () => {
    const redraft = getRankings('redraft-ppr');
    const dynasty = getRankings('dynasty-sf');

    expect(redraft).not.toBe(dynasty);
  });
});
