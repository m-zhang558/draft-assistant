import {
  MIN_ORDER_GAP,
  ORDER_STEP,
  initialSortKeys,
  keyBetween,
  needsRenormalisation,
  renormalise,
  sortIdsByKey,
} from './fractional-order';

describe('keyBetween', () => {
  it('returns ORDER_STEP for an empty board (both neighbours null)', () => {
    expect(keyBetween(null, null)).toBe(ORDER_STEP);
  });

  it('inserts at the head: after - ORDER_STEP', () => {
    expect(keyBetween(null, 5000)).toBe(5000 - ORDER_STEP);
  });

  it('appends at the tail: before + ORDER_STEP', () => {
    expect(keyBetween(3000, null)).toBe(3000 + ORDER_STEP);
  });

  it('returns the midpoint of two neighbours', () => {
    expect(keyBetween(1000, 2000)).toBe(1500);
  });

  it('throws RangeError when before >= after', () => {
    expect(() => keyBetween(2000, 1000)).toThrow(RangeError);
    expect(() => keyBetween(1000, 1000)).toThrow(RangeError);
  });

  it('throws RangeError when before is not finite', () => {
    expect(() => keyBetween(NaN, 1000)).toThrow(RangeError);
    expect(() => keyBetween(Infinity, 1000)).toThrow(RangeError);
  });

  it('throws RangeError when after is not finite', () => {
    expect(() => keyBetween(1000, NaN)).toThrow(RangeError);
    expect(() => keyBetween(1000, -Infinity)).toThrow(RangeError);
  });
});

describe('needsRenormalisation', () => {
  it('is false whenever either neighbour is null (head/tail/empty always have room)', () => {
    expect(needsRenormalisation(null, null)).toBe(false);
    expect(needsRenormalisation(null, 1000)).toBe(false);
    expect(needsRenormalisation(1000, null)).toBe(false);
  });

  it('is false for a fresh ORDER_STEP-spaced gap', () => {
    expect(needsRenormalisation(0, ORDER_STEP)).toBe(false);
  });

  it('is true once the gap is at or below MIN_ORDER_GAP', () => {
    expect(needsRenormalisation(0, MIN_ORDER_GAP)).toBe(true);
    expect(needsRenormalisation(0, MIN_ORDER_GAP / 2)).toBe(true);
  });

  it('is false just above MIN_ORDER_GAP', () => {
    expect(needsRenormalisation(0, MIN_ORDER_GAP * 2)).toBe(false);
  });
});

describe('renormalise', () => {
  it('assigns evenly spaced keys ORDER_STEP, 2*ORDER_STEP, ... in the given order', () => {
    const keys = renormalise(['a', 'b', 'c']);
    expect(keys.get('a')).toBe(ORDER_STEP);
    expect(keys.get('b')).toBe(2 * ORDER_STEP);
    expect(keys.get('c')).toBe(3 * ORDER_STEP);
  });

  it('returns an empty map for an empty list', () => {
    expect(renormalise([])).toEqual(new Map());
  });

  it('throws on a duplicate id', () => {
    expect(() => renormalise(['a', 'b', 'a'])).toThrow(/duplicate/i);
  });
});

describe('initialSortKeys', () => {
  it('is the same behaviour as renormalise (alias for a fresh board seed)', () => {
    const ids = ['x', 'y', 'z'];
    expect(initialSortKeys(ids)).toEqual(renormalise(ids));
  });
});

describe('sortIdsByKey', () => {
  it('sorts ascending by key', () => {
    const keys = new Map([
      ['c', 300],
      ['a', 100],
      ['b', 200],
    ]);
    expect(sortIdsByKey(keys)).toEqual(['a', 'b', 'c']);
  });

  it('breaks ties by id, deterministically, regardless of Map insertion order', () => {
    const keysInsertedOneWay = new Map([
      ['z', 100],
      ['a', 100],
      ['m', 100],
    ]);
    const keysInsertedAnotherWay = new Map([
      ['m', 100],
      ['z', 100],
      ['a', 100],
    ]);
    expect(sortIdsByKey(keysInsertedOneWay)).toEqual(['a', 'm', 'z']);
    expect(sortIdsByKey(keysInsertedAnotherWay)).toEqual(['a', 'm', 'z']);
  });

  it('returns an empty array for an empty map', () => {
    expect(sortIdsByKey(new Map())).toEqual([]);
  });
});

describe('adversarial: 60 consecutive midpoint insertions into the same gap', () => {
  it('needsRenormalisation fires before keyBetween can ever produce a key equal to a neighbour', () => {
    // Simulates a user repeatedly dropping a card into the same spot at the top of a gap: each
    // insertion becomes the new lower bound, so the gap between `before` and `after` halves
    // every time. This is the worst case fractional ordering can face in this app.
    let before = 0;
    const after = ORDER_STEP;
    let renormalisationFiredAtSplit: number | null = null;

    for (let split = 1; split <= 60; split += 1) {
      if (needsRenormalisation(before, after)) {
        renormalisationFiredAtSplit = split;
        break;
      }

      const key = keyBetween(before, after);

      // The core guarantee: as long as the guard hasn't fired, the split must be strictly
      // between its neighbours — never equal to either. An equal key would mean two players
      // silently collapsed onto the same sort position.
      expect(key).toBeGreaterThan(before);
      expect(key).toBeLessThan(after);

      before = key;
    }

    // The guard must have fired within the 60-split budget...
    expect(renormalisationFiredAtSplit).not.toBeNull();
    // ...and with real headroom before floating-point precision could actually collide (the
    // module's own doc comment puts that collision risk around split ~50).
    expect(renormalisationFiredAtSplit as number).toBeLessThan(50);
  });

  it('ignoring the guard, keys stay distinct well past the point where it already fired (headroom check)', () => {
    // The guard fires around split 20 (see needsRenormalisation's test above). Deliberately
    // ignoring it and continuing to bisect the same gap up to split 50 still produces distinct
    // values — confirmed empirically (collision starts around split 54 for an ORDER_STEP-sized
    // gap) — which is the margin `MIN_ORDER_GAP`'s doc comment claims. This is a "the guard is
    // not cutting it close" check, not a claim that ignoring the guard is ever safe in general.
    let before = 0;
    const after = ORDER_STEP;

    for (let split = 1; split <= 50; split += 1) {
      const key = keyBetween(before, after);
      expect(key).toBeGreaterThan(before);
      expect(key).toBeLessThan(after);
      before = key;
    }
  });
});
