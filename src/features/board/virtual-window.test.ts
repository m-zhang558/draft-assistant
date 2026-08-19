import { computeWindow } from './virtual-window';

describe('computeWindow', () => {
  it('renders nothing for an empty list', () => {
    const result = computeWindow({
      scrollTop: 0,
      viewportHeight: 800,
      rowHeight: 40,
      rowCount: 0,
      overscan: 5,
    });
    expect(result).toEqual({ startIndex: 0, endIndex: -1 });
  });

  it('renders the whole list when it is shorter than the viewport', () => {
    const result = computeWindow({
      scrollTop: 0,
      viewportHeight: 800,
      rowHeight: 40,
      rowCount: 5,
      overscan: 2,
    });
    expect(result).toEqual({ startIndex: 0, endIndex: 4 });
  });

  it('computes a window in the middle of a long list, inclusive of overscan', () => {
    // 10 rows visible (500 / 50); scrolled 5 rows down (250 / 50 = 5).
    const result = computeWindow({
      scrollTop: 250,
      viewportHeight: 500,
      rowHeight: 50,
      rowCount: 1000,
      overscan: 3,
    });
    // firstVisible = 5, lastVisible = 5 + 10 - 1 = 14
    expect(result).toEqual({ startIndex: 2, endIndex: 17 });
  });

  it('clamps the start index instead of going negative near the top', () => {
    const result = computeWindow({
      scrollTop: 0,
      viewportHeight: 500,
      rowHeight: 50,
      rowCount: 1000,
      overscan: 5,
    });
    expect(result.startIndex).toBe(0);
  });

  it('clamps the end index instead of exceeding rowCount - 1 near the bottom', () => {
    // Max scroll for 1000 rows * 50px in an 800px viewport is 50000 - 800 = 49200.
    const result = computeWindow({
      scrollTop: 49200,
      viewportHeight: 800,
      rowHeight: 50,
      rowCount: 1000,
      overscan: 5,
    });
    expect(result.endIndex).toBe(999);
    expect(result.startIndex).toBeLessThan(result.endIndex);
  });

  it('renders exactly the last row when scrolled to the very bottom of a short list', () => {
    const result = computeWindow({
      scrollTop: 200, // rowCount(6) * rowHeight(40) - viewportHeight(40) = 200
      viewportHeight: 40,
      rowHeight: 40,
      rowCount: 6,
      overscan: 0,
    });
    expect(result).toEqual({ startIndex: 5, endIndex: 5 });
  });

  it('clamps a scrollTop past the end of the list rather than producing an out-of-range index', () => {
    const result = computeWindow({
      scrollTop: 999_999,
      viewportHeight: 800,
      rowHeight: 40,
      rowCount: 50,
      overscan: 4,
    });
    expect(result.startIndex).toBeGreaterThanOrEqual(0);
    expect(result.endIndex).toBe(49);
    expect(result.startIndex).toBeLessThanOrEqual(result.endIndex);
  });

  it('treats a negative scrollTop as zero rather than throwing', () => {
    const result = computeWindow({
      scrollTop: -100,
      viewportHeight: 200,
      rowHeight: 40,
      rowCount: 20,
      overscan: 1,
    });
    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(5); // 200/40=5 visible rows (indices 0-4) + 1 overscan
  });
});
