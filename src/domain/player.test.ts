import { FORMATS, POSITIONS, isFormat, isPosition } from './player';

describe('POSITIONS', () => {
  it('lists positions in display order', () => {
    expect(POSITIONS).toEqual(['QB', 'RB', 'WR', 'TE', 'K', 'DST']);
  });
});

describe('FORMATS', () => {
  it('lists the supported formats', () => {
    expect(FORMATS).toEqual(['redraft-ppr', 'dynasty-sf']);
  });
});

describe('isPosition', () => {
  it.each(POSITIONS)('accepts %s', (position) => {
    expect(isPosition(position)).toBe(true);
  });

  it('rejects an unknown position string', () => {
    expect(isPosition('QK')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isPosition(1)).toBe(false);
    expect(isPosition(null)).toBe(false);
    expect(isPosition(undefined)).toBe(false);
    expect(isPosition({})).toBe(false);
  });
});

describe('isFormat', () => {
  it.each(FORMATS)('accepts %s', (format) => {
    expect(isFormat(format)).toBe(true);
  });

  it('rejects an unknown format string', () => {
    expect(isFormat('redraft-standard')).toBe(false);
  });

  it('rejects non-string values', () => {
    expect(isFormat(1)).toBe(false);
    expect(isFormat(null)).toBe(false);
    expect(isFormat(undefined)).toBe(false);
  });
});
