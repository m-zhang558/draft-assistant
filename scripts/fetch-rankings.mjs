#!/usr/bin/env node
// Generates src/data/rankings/*.json from Flock Fantasy's public, unauthenticated
// consensus rankings endpoint. See PROJECT.md §3 for the source and the
// normalization decisions this script implements.
//
// Usage: node scripts/fetch-rankings.mjs   (also: npm run fetch:rankings)

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SEASON = 2026;
const SCHEMA_VERSION = 1;

const OUTPUT_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'src',
  'data',
  'rankings'
);

const POSITION_MAP = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DST',
};

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'];

const FORMATS = [
  { format: 'redraft-ppr', upstreamFormat: 'REDRAFT', outputFile: 'redraft-ppr-2026.json' },
  { format: 'dynasty-sf', upstreamFormat: 'SUPERFLEX', outputFile: 'dynasty-sf-2026.json' },
];

function buildUpstreamUrl(upstreamFormat) {
  return `https://api.flockfantasy.com/rankings?format=${upstreamFormat}&pickType=general`;
}

async function fetchUpstream(url) {
  const response = await fetch(url);
  if (response.status !== 200) {
    throw new Error(`Upstream fetch failed for ${url}: HTTP ${response.status}`);
  }

  const body = await response.json();

  if (body === null || typeof body !== 'object') {
    throw new Error(`Upstream response for ${url} was not a JSON object`);
  }

  if ('statusCode' in body && 'body' in body && !('data' in body)) {
    throw new Error(
      `Upstream returned an error envelope for ${url}: ${JSON.stringify(body).slice(0, 500)}`
    );
  }

  if (!Array.isArray(body.data) || body.data.length === 0) {
    throw new Error(`Upstream response for ${url} has no data`);
  }

  if (body.year !== SEASON) {
    throw new Error(
      `Expected upstream year ${SEASON} for ${url}, got ${JSON.stringify(body.year)}`
    );
  }

  return body;
}

function mostRecentTimestamp(lastUpdated, url) {
  if (lastUpdated === null || typeof lastUpdated !== 'object') {
    throw new Error(`Upstream response for ${url} is missing a usable lastUpdated object`);
  }

  const timestamps = Object.values(lastUpdated);
  if (timestamps.length === 0) {
    throw new Error(`Upstream response for ${url} has an empty lastUpdated object`);
  }

  let mostRecent = null;
  let mostRecentMs = -Infinity;
  for (const timestamp of timestamps) {
    const ms = new Date(timestamp.replace(' ', 'T')).getTime();
    if (Number.isNaN(ms)) {
      throw new Error(`Unparseable lastUpdated timestamp for ${url}: ${JSON.stringify(timestamp)}`);
    }
    if (ms > mostRecentMs) {
      mostRecentMs = ms;
      mostRecent = timestamp;
    }
  }

  return mostRecent;
}

function mapPosition(rawPosition, playerId) {
  const mapped = POSITION_MAP[rawPosition];
  if (mapped === undefined) {
    throw new Error(
      `Unrecognized position ${JSON.stringify(rawPosition)} for playerId ${playerId}`
    );
  }
  return mapped;
}

function mapTeam(rawTeam) {
  if (rawTeam === null || rawTeam === '') {
    return 'FA';
  }
  return rawTeam.toUpperCase();
}

function comparePlayers(a, b) {
  const rankA = a.averageRank ?? Number.POSITIVE_INFINITY;
  const rankB = b.averageRank ?? Number.POSITIVE_INFINITY;
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  const positionA = POSITION_ORDER.indexOf(a.position);
  const positionB = POSITION_ORDER.indexOf(b.position);
  if (positionA !== positionB) {
    return positionA - positionB;
  }

  const nameComparison = a.name.localeCompare(b.name, 'en');
  if (nameComparison !== 0) {
    return nameComparison;
  }

  return a.id.localeCompare(b.id, 'en');
}

function transform(body, url) {
  const rows = body.data;
  const retained = rows.filter((row) => row.isDraftPick !== true);
  const droppedDraftPicks = rows.length - retained.length;

  const seenIds = new Set();
  const intermediate = retained.map((row) => {
    if (seenIds.has(row.playerId)) {
      throw new Error(`Duplicate playerId ${row.playerId} in response from ${url}`);
    }
    seenIds.add(row.playerId);

    if (typeof row.playerName !== 'string' || row.playerName.trim() === '') {
      throw new Error(`Missing or blank playerName for playerId ${row.playerId} from ${url}`);
    }

    return {
      id: `flock-${row.playerId}`,
      name: row.playerName,
      position: mapPosition(row.position, row.playerId),
      team: mapTeam(row.team),
      averageRank: row.averageRank,
      averageTier: row.averageTier,
      byeWeek: row.byeWeek,
      age: row.age,
    };
  });

  intermediate.sort(comparePlayers);

  const players = intermediate.map((player, index) => {
    const baseRank = index + 1;
    const out = {
      id: player.id,
      name: player.name,
      position: player.position,
      team: player.team,
      baseRank,
    };
    if (typeof player.averageTier === 'number' && player.averageTier > 0) {
      out.tier = player.averageTier;
    }
    if (player.byeWeek !== null) {
      out.byeWeek = player.byeWeek;
    }
    if (player.age !== null) {
      out.age = player.age;
    }
    return out;
  });

  players.forEach((player, index) => {
    if (player.baseRank !== index + 1) {
      throw new Error(
        `baseRank sequence is not contiguous 1..N at index ${index}: got ${player.baseRank}`
      );
    }
  });

  return { players, droppedDraftPicks };
}

function summarizePositions(players) {
  const counts = {};
  for (const player of players) {
    counts[player.position] = (counts[player.position] ?? 0) + 1;
  }
  return counts;
}

async function processFormat({ format, upstreamFormat, outputFile }) {
  const url = buildUpstreamUrl(upstreamFormat);
  const body = await fetchUpstream(url);
  const upstreamLastUpdated = mostRecentTimestamp(body.lastUpdated, url);
  const { players, droppedDraftPicks } = transform(body, url);

  const output = {
    schemaVersion: SCHEMA_VERSION,
    provenance: {
      source: 'Flock Fantasy',
      sourceUrl: url,
      format,
      season: SEASON,
      retrievedAt: new Date().toISOString(),
      upstreamFormat,
      upstreamLastUpdated,
      playerCount: players.length,
      notes: `Public unauthenticated consensus endpoint; response reported subscribed=${body.subscribed}.`,
    },
    players,
  };

  const outputPath = path.join(OUTPUT_DIR, outputFile);
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const positionBreakdown = summarizePositions(players);
  console.log(`\n${format} (${outputFile})`);
  console.log(`  retained:    ${players.length}`);
  console.log(`  dropped picks: ${droppedDraftPicks}`);
  console.log(`  positions:   ${JSON.stringify(positionBreakdown)}`);
}

for (const formatConfig of FORMATS) {
  await processFormat(formatConfig);
}

console.log('\nDone.');
