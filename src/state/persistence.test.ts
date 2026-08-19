import {
  STORAGE_KEY,
  STORAGE_SCHEMA_VERSION,
  DEFAULT_PREFERENCES,
  PersistedStateError,
  loadPersistedState,
  savePersistedState,
  clearPersistedState,
  serializeState,
  parseStateJson,
  isTheme,
  isDensity,
  type PersistedState,
} from './persistence';

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => {
      data.clear();
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

function validState(): PersistedState {
  return {
    schemaVersion: STORAGE_SCHEMA_VERSION,
    activeFormat: 'redraft-ppr',
    boards: {
      'redraft-ppr': { order: ['p1', 'p2'], drafted: ['p1'] },
      'dynasty-sf': { order: ['p3'], drafted: [] },
    },
    filters: { position: 'ALL', availableOnly: true },
    preferences: { theme: 'system', density: 'comfortable' },
  };
}

/** A v1 blob: same shape as `validState()` minus `preferences`, with schemaVersion 1. */
function v1Blob(): Record<string, unknown> {
  const state = validState();
  return {
    schemaVersion: 1,
    activeFormat: state.activeFormat,
    boards: state.boards,
    filters: state.filters,
  };
}

describe('loadPersistedState', () => {
  it('returns null when nothing is stored (cold start)', () => {
    const storage = createMemoryStorage();

    expect(loadPersistedState(storage)).toBeNull();
  });

  it('round-trips a valid v2 state through save and load', () => {
    const storage = createMemoryStorage();
    const state = validState();

    savePersistedState(state, storage);

    expect(loadPersistedState(storage)).toEqual(state);
  });

  it('loads a v1 blob and attaches the default preferences', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(v1Blob()));

    const loaded = loadPersistedState(storage);

    expect(loaded).not.toBeNull();
    expect(loaded?.schemaVersion).toBe(2);
    expect(loaded?.preferences).toEqual(DEFAULT_PREFERENCES);
    expect(loaded?.activeFormat).toBe('redraft-ppr');
    expect(loaded?.boards['redraft-ppr'].order).toEqual(['p1', 'p2']);
  });

  it('throws PersistedStateError naming STORAGE_KEY for invalid JSON', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, '{not valid json');

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
    try {
      loadPersistedState(storage);
      throw new Error('expected loadPersistedState to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(PersistedStateError);
      expect((error as Error).message).toContain(STORAGE_KEY);
    }
  });

  it('throws PersistedStateError for an unknown schemaVersion', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...validState(), schemaVersion: 999 }));

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
    expect(() => loadPersistedState(storage)).toThrow(new RegExp(STORAGE_KEY.replace('.', '\\.')));
  });

  it('throws PersistedStateError when a format is missing from boards', () => {
    const storage = createMemoryStorage();
    const state = validState();
    const boardsWithoutDynasty = { 'redraft-ppr': state.boards['redraft-ppr'] };
    storage.setItem(STORAGE_KEY, JSON.stringify({ ...state, boards: boardsWithoutDynasty }));

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });

  it('throws PersistedStateError for a bad filters.position', () => {
    const storage = createMemoryStorage();
    const state = validState();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, filters: { ...state.filters, position: 'NOT_A_POSITION' } })
    );

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });

  it('throws PersistedStateError when a board order is not an array', () => {
    const storage = createMemoryStorage();
    const state = validState();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...state,
        boards: {
          ...state.boards,
          'redraft-ppr': { ...state.boards['redraft-ppr'], order: 'p1,p2' },
        },
      })
    );

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });

  it('throws PersistedStateError for a structurally invalid top-level value', () => {
    const storage = createMemoryStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify(['not', 'an', 'object']));

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });

  it('throws PersistedStateError for a missing preferences block on a v2 blob', () => {
    const storage = createMemoryStorage();
    const state = validState();
    const withoutPreferences = {
      schemaVersion: state.schemaVersion,
      activeFormat: state.activeFormat,
      boards: state.boards,
      filters: state.filters,
    };
    storage.setItem(STORAGE_KEY, JSON.stringify(withoutPreferences));

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });

  it('throws PersistedStateError for a bad preferences.theme', () => {
    const storage = createMemoryStorage();
    const state = validState();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, preferences: { ...state.preferences, theme: 'neon' } })
    );

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });

  it('throws PersistedStateError for a bad preferences.density', () => {
    const storage = createMemoryStorage();
    const state = validState();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...state, preferences: { ...state.preferences, density: 'roomy' } })
    );

    expect(() => loadPersistedState(storage)).toThrow(PersistedStateError);
  });
});

describe('clearPersistedState', () => {
  it('removes the stored key so a subsequent load is a cold start', () => {
    const storage = createMemoryStorage();
    savePersistedState(validState(), storage);

    clearPersistedState(storage);

    expect(loadPersistedState(storage)).toBeNull();
  });
});

describe('serializeState / parseStateJson (Phase 3.8 export/import)', () => {
  it('round-trips a valid state through serializeState and parseStateJson', () => {
    const state = validState();

    const json = serializeState(state);
    const parsed = parseStateJson(json);

    expect(parsed).toEqual(state);
  });

  it('serializeState produces pretty-printed JSON', () => {
    const json = serializeState(validState());

    expect(json).toContain('\n');
  });

  it('accepts and migrates a v1 export, same as loadPersistedState', () => {
    const parsed = parseStateJson(JSON.stringify(v1Blob()));

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.preferences).toEqual(DEFAULT_PREFERENCES);
  });

  it('rejects garbage JSON with PersistedStateError', () => {
    expect(() => parseStateJson('not json at all')).toThrow(PersistedStateError);
  });

  it('rejects a structurally invalid backup with PersistedStateError', () => {
    expect(() => parseStateJson(JSON.stringify({ nonsense: true }))).toThrow(PersistedStateError);
  });

  it('shares validation with loadPersistedState: an invalid theme is rejected the same way', () => {
    const state = validState();
    const badJson = JSON.stringify({
      ...state,
      preferences: { ...state.preferences, theme: 'neon' },
    });

    expect(() => parseStateJson(badJson)).toThrow(PersistedStateError);
  });
});

describe('isTheme / isDensity', () => {
  it('accepts the documented values', () => {
    expect(isTheme('light')).toBe(true);
    expect(isTheme('dark')).toBe(true);
    expect(isTheme('system')).toBe(true);
    expect(isDensity('comfortable')).toBe(true);
    expect(isDensity('compact')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isTheme('neon')).toBe(false);
    expect(isTheme(undefined)).toBe(false);
    expect(isDensity('roomy')).toBe(false);
    expect(isDensity(42)).toBe(false);
  });
});
