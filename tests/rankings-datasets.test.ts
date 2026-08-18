/**
 * Integration test for the committed ranking datasets (PROJECT.md §5: `tests/` holds
 * integration tests). Unlike `src/data/sources/validate-dataset.test.ts`, which exercises
 * the validator against synthetic fixtures, this exercises the REAL committed JSON files
 * in `src/data/rankings/` through the REAL `localJsonSource` adapter — the gap a unit test
 * with fixtures can't fill.
 */
import { localJsonSource } from '@/data/sources';
import { FORMATS, POSITIONS, type Format } from '@/domain';

const EXPECTED_PLAYER_COUNTS: Record<Format, number> = {
  'redraft-ppr': 426,
  'dynasty-sf': 439,
};

describe.each(FORMATS)('localJsonSource.load("%s") against the committed dataset', (format) => {
  const dataset = localJsonSource.load(format);

  it('returns a dataset whose provenance.format matches the requested format', () => {
    expect(dataset.provenance.format).toBe(format);
  });

  it(`contains exactly ${String(EXPECTED_PLAYER_COUNTS[format])} players`, () => {
    expect(dataset.players).toHaveLength(EXPECTED_PLAYER_COUNTS[format]);
  });

  it('has baseRank values forming the contiguous sequence 1..N', () => {
    const ranks = dataset.players.map((player) => player.baseRank).sort((a, b) => a - b);
    const expected = Array.from({ length: dataset.players.length }, (_, index) => index + 1);
    expect(ranks).toEqual(expected);
  });

  it('has unique player ids', () => {
    const ids = new Set(dataset.players.map((player) => player.id));
    expect(ids.size).toBe(dataset.players.length);
  });

  it('has every position in POSITIONS', () => {
    for (const player of dataset.players) {
      expect(POSITIONS).toContain(player.position);
    }
  });

  it('has no player with an explicitly null/undefined id, name, team, or baseRank', () => {
    for (const player of dataset.players) {
      expect(player.id).not.toBeNull();
      expect(player.id).not.toBeUndefined();
      expect(player.name).not.toBeNull();
      expect(player.name).not.toBeUndefined();
      expect(player.team).not.toBeNull();
      expect(player.team).not.toBeUndefined();
      expect(player.baseRank).not.toBeNull();
      expect(player.baseRank).not.toBeUndefined();
    }
  });

  it('has provenance.season === 2026 and playerCount matching the actual player array length', () => {
    expect(dataset.provenance.season).toBe(2026);
    expect(dataset.provenance.playerCount).toBe(dataset.players.length);
  });
});

describe('dynasty-sf position coverage', () => {
  it('contains no K or DST players (upstream does not rank kickers or defences for superflex)', () => {
    const dataset = localJsonSource.load('dynasty-sf');
    const positions = new Set(dataset.players.map((player) => player.position));

    expect(positions.has('K')).toBe(false);
    expect(positions.has('DST')).toBe(false);
  });
});
