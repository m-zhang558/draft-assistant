import {
  MAX_BOARD_NAME_LENGTH,
  createBoardMeta,
  isBoardMeta,
  nextBoardName,
  normaliseBoardName,
  validateBoardName,
} from './boards';

describe('normaliseBoardName', () => {
  it('trims leading and trailing whitespace', () => {
    expect(normaliseBoardName('  Redraft PPR  ')).toBe('Redraft PPR');
  });

  it('collapses internal runs of whitespace to a single space', () => {
    expect(normaliseBoardName('Redraft   PPR\t\tLeague')).toBe('Redraft PPR League');
  });

  it('leaves an already-normalised name unchanged', () => {
    expect(normaliseBoardName('Redraft PPR')).toBe('Redraft PPR');
  });
});

describe('validateBoardName', () => {
  it('returns the normalised name for a valid input', () => {
    expect(validateBoardName('  Dynasty  SF  ')).toBe('Dynasty SF');
  });

  it('throws when the name is empty after trimming', () => {
    expect(() => validateBoardName('   ')).toThrow(/empty/i);
    expect(() => validateBoardName('')).toThrow(/empty/i);
  });

  it('throws when the name exceeds MAX_BOARD_NAME_LENGTH', () => {
    const tooLong = 'a'.repeat(MAX_BOARD_NAME_LENGTH + 1);
    expect(() => validateBoardName(tooLong)).toThrow(/exceeds/i);
  });

  it('accepts a name exactly at MAX_BOARD_NAME_LENGTH', () => {
    const exact = 'a'.repeat(MAX_BOARD_NAME_LENGTH);
    expect(validateBoardName(exact)).toBe(exact);
  });
});

describe('nextBoardName', () => {
  it('returns the base name unchanged when there is no collision', () => {
    expect(nextBoardName(['Other Board'], 'Redraft PPR')).toBe('Redraft PPR');
  });

  it('appends " (2)" on a single collision', () => {
    expect(nextBoardName(['Redraft PPR'], 'Redraft PPR')).toBe('Redraft PPR (2)');
  });

  it('finds the next free number when several duplicates already exist', () => {
    const existing = ['Redraft PPR', 'Redraft PPR (2)', 'Redraft PPR (3)'];
    expect(nextBoardName(existing, 'Redraft PPR')).toBe('Redraft PPR (4)');
  });

  it('is not confused by a gap in the numbering (still walks from 2 upward)', () => {
    const existing = ['Redraft PPR', 'Redraft PPR (3)'];
    expect(nextBoardName(existing, 'Redraft PPR')).toBe('Redraft PPR (2)');
  });

  it('is case-sensitive when checking for a collision', () => {
    expect(nextBoardName(['redraft ppr'], 'Redraft PPR')).toBe('Redraft PPR');
  });
});

describe('createBoardMeta', () => {
  it('builds a BoardMeta from the given id, name, format, and timestamp, without generating them itself', () => {
    const meta = createBoardMeta(
      'board-1',
      'Redraft PPR',
      'redraft-ppr',
      '2026-08-19T00:00:00.000Z'
    );
    expect(meta).toEqual({
      id: 'board-1',
      name: 'Redraft PPR',
      format: 'redraft-ppr',
      createdAt: '2026-08-19T00:00:00.000Z',
    });
  });
});

describe('isBoardMeta', () => {
  it('accepts a well-formed BoardMeta', () => {
    const meta = createBoardMeta(
      'board-1',
      'Redraft PPR',
      'redraft-ppr',
      '2026-08-19T00:00:00.000Z'
    );
    expect(isBoardMeta(meta)).toBe(true);
  });

  it('rejects null and non-objects', () => {
    expect(isBoardMeta(null)).toBe(false);
    expect(isBoardMeta(undefined)).toBe(false);
    expect(isBoardMeta('board-1')).toBe(false);
    expect(isBoardMeta(42)).toBe(false);
  });

  it('rejects an object missing a required field', () => {
    expect(isBoardMeta({ id: 'x', name: 'y', format: 'redraft-ppr' })).toBe(false);
  });

  it('rejects an invalid format value', () => {
    expect(
      isBoardMeta({ id: 'x', name: 'y', format: 'invalid-format', createdAt: '2026-01-01' })
    ).toBe(false);
  });

  it('rejects wrong field types', () => {
    expect(isBoardMeta({ id: 1, name: 'y', format: 'redraft-ppr', createdAt: '2026-01-01' })).toBe(
      false
    );
  });
});
