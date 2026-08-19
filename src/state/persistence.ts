/**
 * localStorage read/write for board state, with fail-fast validation (PROJECT.md §6).
 *
 * An ABSENT key is a normal cold start: `loadPersistedState` returns `null`. A key that IS
 * present but unparseable, versioned wrong, or structurally invalid is a corrupt board — that
 * throws `PersistedStateError` naming `STORAGE_KEY` so a user (or a bug report) can point at
 * exactly what to clear. There is no silent recovery: a half-valid persisted board is worse
 * than no persisted board, because it would quietly discard a user's draft-day customization.
 *
 * `schemaVersion` is the migration seam (PROJECT.md §5): an unknown version still throws, but a
 * known OLD version is validated against its own rules and then migrated forward by an explicit,
 * named step — never patched in place by an `if` buried in the parser, because each future
 * version follows the same pattern (`migrateV1ToV2`, then `migrateV2ToV3`, ...).
 *
 * `parseStateJson` (Phase 3.8 export/import) intentionally shares this exact parse/migrate path:
 * an exported backup file *is* a serialized `PersistedState`, so it deserves exactly the same
 * validation a localStorage read gets — no separate, drifting copy of the rules.
 */
import {
  FORMATS,
  isFormat,
  isPosition,
  POSITION_FILTER_ALL,
  type Format,
  type PositionFilter,
} from '@/domain';

export const STORAGE_KEY = 'fantasy-assist.state';
export const STORAGE_SCHEMA_VERSION = 2;

export const THEMES = ['light', 'dark', 'system'] as const;
export type Theme = (typeof THEMES)[number];

export const DENSITIES = ['comfortable', 'compact'] as const;
export type Density = (typeof DENSITIES)[number];

const THEME_SET: ReadonlySet<string> = new Set(THEMES);
const DENSITY_SET: ReadonlySet<string> = new Set(DENSITIES);

/** Narrows an unknown value to a valid {@link Theme}. */
export function isTheme(value: unknown): value is Theme {
  return typeof value === 'string' && THEME_SET.has(value);
}

/** Narrows an unknown value to a valid {@link Density}. */
export function isDensity(value: unknown): value is Density {
  return typeof value === 'string' && DENSITY_SET.has(value);
}

export interface PersistedPreferences {
  theme: Theme;
  density: Density;
}

export const DEFAULT_PREFERENCES: PersistedPreferences = {
  theme: 'system',
  density: 'comfortable',
};

export interface PersistedBoard {
  order: string[];
  drafted: string[];
}

export interface PersistedState {
  schemaVersion: number;
  activeFormat: Format;
  boards: Record<Format, PersistedBoard>;
  filters: { position: PositionFilter; availableOnly: boolean };
  preferences: PersistedPreferences;
}

/** Thrown by `loadPersistedState` when a stored value exists but cannot be trusted. */
export class PersistedStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PersistedStateError';
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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isPositionFilter(value: unknown): value is PositionFilter {
  return value === POSITION_FILTER_ALL || isPosition(value);
}

function fail(message: string): never {
  throw new PersistedStateError(
    `${message} Stored value under localStorage key "${STORAGE_KEY}" is corrupt — clear it ` +
      `(localStorage.removeItem("${STORAGE_KEY}")) to reset the board.`
  );
}

function parseBoard(raw: unknown, format: Format): PersistedBoard {
  if (!isRecord(raw)) {
    fail(`${STORAGE_KEY}: boards.${format} must be an object, got ${describeType(raw)}.`);
  }
  if (!isStringArray(raw.order)) {
    fail(
      `${STORAGE_KEY}: boards.${format}.order must be a string array, got ${describeType(raw.order)}.`
    );
  }
  if (!isStringArray(raw.drafted)) {
    fail(
      `${STORAGE_KEY}: boards.${format}.drafted must be a string array, got ${describeType(raw.drafted)}.`
    );
  }
  return { order: raw.order, drafted: raw.drafted };
}

function parseBoards(raw: unknown): Record<Format, PersistedBoard> {
  if (!isRecord(raw)) {
    fail(`${STORAGE_KEY}.boards must be an object, got ${describeType(raw)}.`);
  }

  const boards = {} as Record<Format, PersistedBoard>;
  for (const format of FORMATS) {
    if (!(format in raw)) {
      fail(`${STORAGE_KEY}.boards is missing an entry for format "${format}".`);
    }
    boards[format] = parseBoard(raw[format], format);
  }
  return boards;
}

function parseFilters(raw: unknown): { position: PositionFilter; availableOnly: boolean } {
  if (!isRecord(raw)) {
    fail(`${STORAGE_KEY}.filters must be an object, got ${describeType(raw)}.`);
  }

  if (!isPositionFilter(raw.position)) {
    fail(`${STORAGE_KEY}.filters.position is invalid, got ${describeType(raw.position)}.`);
  }

  if (typeof raw.availableOnly !== 'boolean') {
    fail(
      `${STORAGE_KEY}.filters.availableOnly must be a boolean, got ${describeType(raw.availableOnly)}.`
    );
  }

  return { position: raw.position, availableOnly: raw.availableOnly };
}

function parsePreferences(raw: unknown): PersistedPreferences {
  if (!isRecord(raw)) {
    fail(`${STORAGE_KEY}.preferences must be an object, got ${describeType(raw)}.`);
  }

  if (!isTheme(raw.theme)) {
    fail(
      `${STORAGE_KEY}.preferences.theme must be one of ${THEMES.join(', ')}, got ${describeType(raw.theme)}.`
    );
  }

  if (!isDensity(raw.density)) {
    fail(
      `${STORAGE_KEY}.preferences.density must be one of ${DENSITIES.join(', ')}, got ${describeType(raw.density)}.`
    );
  }

  return { theme: raw.theme, density: raw.density };
}

/** Fields shared by every schema version: everything except `preferences`. */
interface ParsedCore {
  activeFormat: Format;
  boards: Record<Format, PersistedBoard>;
  filters: { position: PositionFilter; availableOnly: boolean };
}

function parseCore(raw: Record<string, unknown>): ParsedCore {
  if (!isFormat(raw.activeFormat)) {
    fail(
      `${STORAGE_KEY}.activeFormat must be one of ${FORMATS.join(', ')}, got ${describeType(raw.activeFormat)}.`
    );
  }

  return {
    activeFormat: raw.activeFormat,
    boards: parseBoards(raw.boards),
    filters: parseFilters(raw.filters),
  };
}

/** Validates a schemaVersion-1 payload against v1's own rules (no `preferences` field yet). */
function parseV1(raw: Record<string, unknown>): ParsedCore {
  return parseCore(raw);
}

/** Forward-only migration: v1 had no preferences, so a migrated blob gets the documented defaults. */
function migrateV1ToV2(v1: ParsedCore): PersistedState {
  return {
    schemaVersion: 2,
    activeFormat: v1.activeFormat,
    boards: v1.boards,
    filters: v1.filters,
    preferences: DEFAULT_PREFERENCES,
  };
}

/** Validates a schemaVersion-2 payload, including its required `preferences` block. */
function parseV2(raw: Record<string, unknown>): PersistedState {
  const core = parseCore(raw);
  return {
    schemaVersion: 2,
    activeFormat: core.activeFormat,
    boards: core.boards,
    filters: core.filters,
    preferences: parsePreferences(raw.preferences),
  };
}

function parsePersistedState(raw: unknown): PersistedState {
  if (!isRecord(raw)) {
    fail(`${STORAGE_KEY} must be a JSON object, got ${describeType(raw)}.`);
  }

  if (raw.schemaVersion === 1) {
    return migrateV1ToV2(parseV1(raw));
  }

  if (raw.schemaVersion === STORAGE_SCHEMA_VERSION) {
    return parseV2(raw);
  }

  fail(
    `${STORAGE_KEY} has unsupported schemaVersion ${JSON.stringify(raw.schemaVersion)}; expected ${STORAGE_SCHEMA_VERSION} (or 1, migrated automatically).`
  );
}

/**
 * `null` when NOTHING is stored (normal cold start).
 * Throws `PersistedStateError` when a value IS stored but is unparseable, carries an unknown
 * schemaVersion, or is structurally invalid — the message names `STORAGE_KEY` so the user can
 * clear it. No silent recovery. A stored v1 blob is validated against v1's rules and migrated
 * forward transparently; callers always get back the current shape.
 */
export function loadPersistedState(storage: Storage): PersistedState | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (raw === null) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`${STORAGE_KEY} contains invalid JSON (${detail}).`);
  }

  return parsePersistedState(parsed);
}

export function savePersistedState(state: PersistedState, storage: Storage): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function clearPersistedState(storage: Storage): void {
  storage.removeItem(STORAGE_KEY);
}

/** Pretty-printed JSON for a downloadable backup file (Phase 3.8 export). */
export function serializeState(state: PersistedState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * Parses and validates an imported backup file (Phase 3.8 import). Shares `loadPersistedState`'s
 * exact parse/migrate path — a v1 export is accepted and migrated, just like a v1 localStorage
 * read. Throws `PersistedStateError` for anything that fails validation.
 */
export function parseStateJson(text: string): PersistedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    fail(`${STORAGE_KEY} import contains invalid JSON (${detail}).`);
  }

  return parsePersistedState(parsed);
}
