import { DatasetValidationError, parseRankingDataset } from './validate-dataset';

const baseProvenance = {
  source: 'Flock Fantasy (manual export)',
  sourceUrl: 'https://flockfantasy.com/rankings',
  format: 'redraft-ppr',
  season: 2026,
  retrievedAt: '2026-08-01T00:00:00.000Z',
  upstreamFormat: 'redraft-ppr',
  upstreamLastUpdated: '2026-07-30T00:00:00.000Z',
  playerCount: 3,
  notes: 'Manually transcribed from an entitled account.',
};

function buildPlayer(overrides: Record<string, unknown> = {}, index = 0): Record<string, unknown> {
  return {
    id: `player-${index}`,
    name: `Player ${index}`,
    position: 'RB',
    team: 'KC',
    baseRank: index + 1,
    ...overrides,
  };
}

function buildDataset(
  overrides: {
    schemaVersion?: unknown;
    provenance?: unknown;
    players?: unknown;
  } = {}
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    provenance: baseProvenance,
    players: [buildPlayer({}, 0), buildPlayer({}, 1), buildPlayer({}, 2)],
    ...overrides,
  };
}

describe('parseRankingDataset', () => {
  it('parses a valid dataset into a typed RankingDataset', () => {
    const dataset = parseRankingDataset(buildDataset(), 'redraft-ppr');

    expect(dataset.format).toBe('redraft-ppr');
    expect(dataset.players).toHaveLength(3);
    expect(dataset.players[0]).toEqual({
      id: 'player-0',
      name: 'Player 0',
      position: 'RB',
      team: 'KC',
      baseRank: 1,
    });
    expect(dataset.provenance.source).toBe(baseProvenance.source);
  });

  it('leaves optional player fields absent when not supplied', () => {
    const dataset = parseRankingDataset(buildDataset(), 'redraft-ppr');

    expect(dataset.players[0]).not.toHaveProperty('tier');
    expect(dataset.players[0]).not.toHaveProperty('byeWeek');
    expect(dataset.players[0]).not.toHaveProperty('age');
  });

  it('accepts optional player fields when present as positive integers', () => {
    const players = [
      buildPlayer({ tier: 1, byeWeek: 9, age: 27 }, 0),
      buildPlayer({}, 1),
      buildPlayer({}, 2),
    ];
    const dataset = parseRankingDataset(buildDataset({ players }), 'redraft-ppr');

    expect(dataset.players[0]).toMatchObject({ tier: 1, byeWeek: 9, age: 27 });
  });

  it('rejects a non-object top-level value', () => {
    expect(() => parseRankingDataset(null, 'redraft-ppr')).toThrow(DatasetValidationError);
    expect(() => parseRankingDataset(null, 'redraft-ppr')).toThrow(/must be a JSON object/);
    expect(() => parseRankingDataset([1, 2, 3], 'redraft-ppr')).toThrow(/must be a JSON object/);
  });

  it('rejects a dataset with a missing players array', () => {
    const raw = buildDataset({ players: undefined });
    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /"players" must be a non-empty array/
    );
  });

  it('rejects a dataset with an empty players array', () => {
    const raw = buildDataset({ players: [] });
    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /"players" must be a non-empty array/
    );
  });

  it('rejects an unsupported schemaVersion', () => {
    const raw = buildDataset({ schemaVersion: 2 });
    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(/unsupported schemaVersion/);
  });

  it('rejects a dataset missing a provenance field', () => {
    const provenanceWithoutNotes: Record<string, unknown> = { ...baseProvenance };
    delete provenanceWithoutNotes['notes'];
    const raw = buildDataset({ provenance: provenanceWithoutNotes });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /provenance\.notes must be a string/
    );
  });

  it('rejects a provenance.format mismatch against the requested format', () => {
    const raw = buildDataset({ provenance: { ...baseProvenance, format: 'dynasty-sf' } });
    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /provenance\.format is "dynasty-sf" but this dataset was loaded as "redraft-ppr"/
    );
  });

  it('rejects a duplicate player id', () => {
    const players = [buildPlayer({}, 0), buildPlayer({ id: 'player-0' }, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(/Duplicate player id "player-0"/);
  });

  it('rejects an unknown position', () => {
    const players = [buildPlayer({ position: 'QK' }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(/unknown position "QK"/);
  });

  it('rejects a blank name', () => {
    const players = [buildPlayer({ name: '   ' }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /name must be a non-empty string/
    );
  });

  it('rejects a blank id', () => {
    const players = [buildPlayer({ id: '' }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /players\[0\]\.id must be a non-empty string/
    );
  });

  it('rejects a blank team', () => {
    const players = [buildPlayer({ team: '' }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /team must be a non-empty string/
    );
  });

  it('rejects a non-integer baseRank', () => {
    const players = [buildPlayer({ baseRank: 1.5 }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /baseRank must be a positive integer/
    );
  });

  it('rejects a rank gap in the baseRank sequence', () => {
    const players = [
      buildPlayer({ baseRank: 1 }, 0),
      buildPlayer({ baseRank: 2 }, 1),
      buildPlayer({ baseRank: 4 }, 2),
    ];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /contiguous sequence from 1 to 3; missing 3/
    );
  });

  it('rejects a duplicate baseRank', () => {
    const players = [
      buildPlayer({ baseRank: 1 }, 0),
      buildPlayer({ baseRank: 1 }, 1),
      buildPlayer({ baseRank: 3 }, 2),
    ];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(/Duplicate baseRank 1/);
  });

  it('rejects an explicit null for an optional field instead of omitting it', () => {
    const players = [buildPlayer({ tier: null }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /tier must be a positive integer when present, got null/
    );
  });

  it('rejects a non-positive-integer optional field', () => {
    const players = [buildPlayer({ byeWeek: 0 }, 0), buildPlayer({}, 1), buildPlayer({}, 2)];
    const raw = buildDataset({ players });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /byeWeek must be a positive integer when present/
    );
  });

  it('rejects a provenance.playerCount that disagrees with the actual player count', () => {
    const raw = buildDataset({ provenance: { ...baseProvenance, playerCount: 4 } });

    expect(() => parseRankingDataset(raw, 'redraft-ppr')).toThrow(
      /provenance\.playerCount is 4 but the dataset contains 3 players/
    );
  });
});
