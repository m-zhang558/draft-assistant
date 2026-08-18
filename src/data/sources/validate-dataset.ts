/**
 * Parse-and-throw validation for raw JSON ranking datasets (PROJECT.md §6 "fail fast").
 *
 * `parseRankingDataset` takes `unknown` (never trust a JSON file's inferred shape) and
 * either returns a fully-typed `RankingDataset` or throws a `DatasetValidationError`
 * describing exactly which field or player is malformed. There is no schema library here
 * by design — the checks are hand-written and dependency-free.
 */
import { FORMATS, POSITIONS, isFormat, isPosition, type Format, type Player } from '@/domain';
import type { Provenance, RankingDataset } from './ranking-source';

/** Thrown by `parseRankingDataset` so callers can distinguish bad data from other errors. */
export class DatasetValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatasetValidationError';
  }
}

function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** Requires `record[field]` to be a non-empty string; throws naming `path.field` otherwise. */
function requireString(record: Record<string, unknown>, field: string, path: string): string {
  const value = record[field];
  if (!isNonEmptyString(value)) {
    throw new DatasetValidationError(
      `${path}.${field} must be a non-empty string, got ${describeType(value)}.`
    );
  }
  return value;
}

/** Requires `record[field]` to be a positive integer; throws naming `path.field` otherwise. */
function requirePositiveInteger(
  record: Record<string, unknown>,
  field: string,
  path: string
): number {
  const value = record[field];
  if (!isPositiveInteger(value)) {
    throw new DatasetValidationError(
      `${path}.${field} must be a positive integer, got ${describeType(value)}.`
    );
  }
  return value;
}

/**
 * Optional positive-integer field: absent is valid (returns undefined), but an explicit
 * `null` — or any other non-positive-integer value — is rejected.
 */
function optionalPositiveInteger(
  record: Record<string, unknown>,
  field: string,
  path: string
): number | undefined {
  if (!(field in record) || record[field] === undefined) {
    return undefined;
  }
  const value = record[field];
  if (!isPositiveInteger(value)) {
    throw new DatasetValidationError(
      `${path}.${field} must be a positive integer when present, got ${describeType(value)}.`
    );
  }
  return value;
}

function parseProvenance(raw: unknown, expectedFormat: Format): Provenance {
  if (!isRecord(raw)) {
    throw new DatasetValidationError(`provenance must be an object, got ${describeType(raw)}.`);
  }

  const source = requireString(raw, 'source', 'provenance');
  const sourceUrl = requireString(raw, 'sourceUrl', 'provenance');
  const retrievedAt = requireString(raw, 'retrievedAt', 'provenance');
  const upstreamFormat = requireString(raw, 'upstreamFormat', 'provenance');
  const upstreamLastUpdated = requireString(raw, 'upstreamLastUpdated', 'provenance');
  const season = requirePositiveInteger(raw, 'season', 'provenance');
  const playerCount = requirePositiveInteger(raw, 'playerCount', 'provenance');

  const notesValue = raw.notes;
  if (typeof notesValue !== 'string') {
    throw new DatasetValidationError(
      `provenance.notes must be a string, got ${describeType(notesValue)}.`
    );
  }
  const notes = notesValue;

  const formatValue = raw.format;
  if (!isFormat(formatValue)) {
    throw new DatasetValidationError(
      `provenance.format must be one of ${FORMATS.join(', ')}, got ${describeType(formatValue)}.`
    );
  }
  if (formatValue !== expectedFormat) {
    throw new DatasetValidationError(
      `provenance.format is "${formatValue}" but this dataset was loaded as "${expectedFormat}".`
    );
  }

  return {
    source,
    sourceUrl,
    format: formatValue,
    season,
    retrievedAt,
    upstreamFormat,
    upstreamLastUpdated,
    playerCount,
    notes,
  };
}

function parsePlayer(raw: unknown, index: number): Player {
  const basePath = `players[${index}]`;
  if (!isRecord(raw)) {
    throw new DatasetValidationError(`${basePath} must be an object, got ${describeType(raw)}.`);
  }

  const id = requireString(raw, 'id', basePath);
  const path = `${basePath} (id "${id}")`;

  const name = requireString(raw, 'name', path);
  const team = requireString(raw, 'team', path);

  const positionValue = raw.position;
  if (!isPosition(positionValue)) {
    const shown =
      typeof positionValue === 'string' ? `"${positionValue}"` : describeType(positionValue);
    throw new DatasetValidationError(
      `${path} has unknown position ${shown}; expected one of ${POSITIONS.join(', ')}.`
    );
  }

  const baseRank = requirePositiveInteger(raw, 'baseRank', path);

  const tier = optionalPositiveInteger(raw, 'tier', path);
  const byeWeek = optionalPositiveInteger(raw, 'byeWeek', path);
  const age = optionalPositiveInteger(raw, 'age', path);

  return {
    id,
    name,
    position: positionValue,
    team,
    baseRank,
    ...(tier !== undefined ? { tier } : {}),
    ...(byeWeek !== undefined ? { byeWeek } : {}),
    ...(age !== undefined ? { age } : {}),
  };
}

/**
 * Parses and validates a raw JSON value into a `RankingDataset`, or throws a
 * `DatasetValidationError` naming the offending field or player.
 */
export function parseRankingDataset(raw: unknown, expectedFormat: Format): RankingDataset {
  if (!isRecord(raw)) {
    throw new DatasetValidationError(
      `Ranking dataset must be a JSON object, got ${describeType(raw)}.`
    );
  }

  const schemaVersion = raw.schemaVersion;
  if (schemaVersion !== 1) {
    throw new DatasetValidationError(
      `Ranking dataset has unsupported schemaVersion ${JSON.stringify(schemaVersion)}; expected 1.`
    );
  }

  const provenance = parseProvenance(raw.provenance, expectedFormat);

  const rawPlayers = raw.players;
  if (!Array.isArray(rawPlayers) || rawPlayers.length === 0) {
    throw new DatasetValidationError(
      `Ranking dataset "players" must be a non-empty array, got ${describeType(rawPlayers)}.`
    );
  }

  const players: Player[] = [];
  const seenIds = new Map<string, number>();
  const seenRanks = new Map<number, string>();

  rawPlayers.forEach((rawPlayer, index) => {
    const player = parsePlayer(rawPlayer, index);

    const firstSeenIndex = seenIds.get(player.id);
    if (firstSeenIndex !== undefined) {
      throw new DatasetValidationError(
        `Duplicate player id "${player.id}" at players[${index}] (first seen at players[${firstSeenIndex}]).`
      );
    }
    seenIds.set(player.id, index);

    const firstSeenId = seenRanks.get(player.baseRank);
    if (firstSeenId !== undefined) {
      throw new DatasetValidationError(
        `Duplicate baseRank ${player.baseRank} used by players "${firstSeenId}" and "${player.id}".`
      );
    }
    seenRanks.set(player.baseRank, player.id);

    players.push(player);
  });

  const expectedCount = players.length;
  for (let rank = 1; rank <= expectedCount; rank += 1) {
    if (!seenRanks.has(rank)) {
      throw new DatasetValidationError(
        `Ranking dataset baseRank values must form a contiguous sequence from 1 to ${expectedCount}; missing ${rank}.`
      );
    }
  }

  if (provenance.playerCount !== players.length) {
    throw new DatasetValidationError(
      `provenance.playerCount is ${provenance.playerCount} but the dataset contains ${players.length} players.`
    );
  }

  return { format: expectedFormat, players, provenance };
}
