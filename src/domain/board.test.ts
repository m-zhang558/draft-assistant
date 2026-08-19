import type { Player } from './player';
import {
  initialOrder,
  moveInFilteredView,
  rankDelta,
  rankIndex,
  reconcileOrder,
  resolveDragMove,
} from './board';

function player(id: string, baseRank: number, overrides: Partial<Player> = {}): Player {
  return {
    id,
    name: `Player ${id}`,
    position: 'RB',
    team: 'AAA',
    baseRank,
    ...overrides,
  };
}

describe('initialOrder', () => {
  it('sorts by baseRank ascending regardless of input order', () => {
    const players = [player('c', 3), player('a', 1), player('b', 2)];
    expect(initialOrder(players)).toEqual(['a', 'b', 'c']);
  });

  it('handles an already-sorted list', () => {
    const players = [player('a', 1), player('b', 2), player('c', 3)];
    expect(initialOrder(players)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty array for an empty dataset', () => {
    expect(initialOrder([])).toEqual([]);
  });
});

describe('reconcileOrder', () => {
  it('is unchanged when the persisted order already matches the dataset', () => {
    const players = [player('a', 1), player('b', 2), player('c', 3)];
    expect(reconcileOrder(['a', 'b', 'c'], players)).toEqual(['a', 'b', 'c']);
  });

  it('drops ids that are no longer in the dataset', () => {
    const players = [player('a', 1), player('b', 2)];
    expect(reconcileOrder(['a', 'zzz', 'b'], players)).toEqual(['a', 'b']);
  });

  it('collapses duplicate ids to their first occurrence', () => {
    const players = [player('a', 1), player('b', 2)];
    expect(reconcileOrder(['a', 'b', 'a'], players)).toEqual(['a', 'b']);
  });

  it('inserts a brand-new player at the front when its baseRank is lowest', () => {
    const players = [player('a', 2), player('b', 3), player('new', 1)];
    expect(reconcileOrder(['a', 'b'], players)).toEqual(['new', 'a', 'b']);
  });

  it('inserts a brand-new player in the middle by baseRank', () => {
    const players = [player('a', 1), player('b', 3), player('new', 2)];
    expect(reconcileOrder(['a', 'b'], players)).toEqual(['a', 'new', 'b']);
  });

  it('appends a brand-new player at the end when its baseRank is highest', () => {
    const players = [player('a', 1), player('b', 2), player('new', 3)];
    expect(reconcileOrder(['a', 'b'], players)).toEqual(['a', 'b', 'new']);
  });

  it('treats an empty persisted order the same as initialOrder', () => {
    const players = [player('c', 3), player('a', 1), player('b', 2)];
    expect(reconcileOrder([], players)).toEqual(initialOrder(players));
  });

  it('preserves heavy user customisation while inserting a new player', () => {
    // Base order by rank would be a(1), b(2), c(3) but the user reversed it entirely.
    const players = [player('a', 1), player('b', 2), player('c', 3)];
    const persisted = ['c', 'b', 'a'];
    expect(reconcileOrder(persisted, players)).toEqual(['c', 'b', 'a']);

    // A new player with baseRank 4 (highest) arrives — customisation must survive, new
    // player appended since no persisted player has a greater baseRank.
    const withNewPlayer = [...players, player('d', 4)];
    expect(reconcileOrder(persisted, withNewPlayer)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('inserts multiple new players by ascending baseRank without disturbing customisation', () => {
    // Customised persisted order swaps a and b; baseRanks: a=1, b=2, c=5.
    const persisted = ['b', 'a', 'c'];
    const players = [
      player('a', 1),
      player('b', 2),
      player('c', 5),
      player('d', 3), // new, baseRank between b(2) and c(5)
      player('e', 4), // new, baseRank between d(3) and c(5)
    ];
    // d(3) is inserted before the first persisted-order player with baseRank > 3, which is
    // c(5) -> ['b', 'a', 'd', 'c']. e(4) is then inserted before c(5) too, after d(3) since
    // d's baseRank (3) is not greater than e's (4) -> ['b', 'a', 'd', 'e', 'c'].
    expect(reconcileOrder(persisted, players)).toEqual(['b', 'a', 'd', 'e', 'c']);
  });
});

describe('moveInFilteredView', () => {
  it('behaves like a plain array move when the view is unfiltered (forward)', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveInFilteredView(order, order, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('behaves like a plain array move when the view is unfiltered (backward)', () => {
    const order = ['a', 'b', 'c', 'd'];
    expect(moveInFilteredView(order, order, 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('leaves every hidden player at exactly its original index when the view is filtered', () => {
    // Full order: positions 0..5 = a,b,c,d,e,f. Visible (filtered) view = b, d, f (hidden: a,c,e).
    const order = ['a', 'b', 'c', 'd', 'e', 'f'];
    const visibleIds = ['b', 'd', 'f'];

    // Move visible index 0 (b) to visible index 2 (after f): visible becomes d, f, b.
    const result = moveInFilteredView(order, visibleIds, 0, 2);

    expect(result).toEqual(['a', 'd', 'c', 'f', 'e', 'b']);
    // Hidden ids a, c, e are still at their original full-order indices.
    expect(result.indexOf('a')).toBe(0);
    expect(result.indexOf('c')).toBe(2);
    expect(result.indexOf('e')).toBe(4);
  });

  it('a move to the same index is a no-op', () => {
    const order = ['a', 'b', 'c', 'd'];
    const visibleIds = ['a', 'c'];
    expect(moveInFilteredView(order, visibleIds, 1, 1)).toEqual(order);
  });

  it('throws RangeError for an out-of-bounds fromIndex', () => {
    const order = ['a', 'b', 'c'];
    expect(() => moveInFilteredView(order, order, 5, 0)).toThrow(RangeError);
    expect(() => moveInFilteredView(order, order, -1, 0)).toThrow(RangeError);
  });

  it('throws RangeError for an out-of-bounds toIndex', () => {
    const order = ['a', 'b', 'c'];
    expect(() => moveInFilteredView(order, order, 0, 5)).toThrow(RangeError);
    expect(() => moveInFilteredView(order, order, 0, -1)).toThrow(RangeError);
  });

  it('throws RangeError when visibleIds contains an id absent from order', () => {
    const order = ['a', 'b', 'c'];
    expect(() => moveInFilteredView(order, ['a', 'zzz'], 0, 1)).toThrow(RangeError);
  });

  it('throws RangeError when visibleIds is out of relative order vs order', () => {
    const order = ['a', 'b', 'c', 'd'];
    // In `order`, b comes before d — visibleIds claims the opposite relative order.
    expect(() => moveInFilteredView(order, ['d', 'b'], 0, 1)).toThrow(RangeError);
  });
});

describe('resolveDragMove', () => {
  it('resolves a normal downward move', () => {
    const visibleIds = ['a', 'b', 'c', 'd'];
    expect(resolveDragMove(visibleIds, 'a', 'c')).toEqual({ fromIndex: 0, toIndex: 2 });
  });

  it('resolves a normal upward move', () => {
    const visibleIds = ['a', 'b', 'c', 'd'];
    expect(resolveDragMove(visibleIds, 'd', 'b')).toEqual({ fromIndex: 3, toIndex: 1 });
  });

  it('returns null when dropped outside the list (overId is null)', () => {
    const visibleIds = ['a', 'b', 'c'];
    expect(resolveDragMove(visibleIds, 'a', null)).toBeNull();
  });

  it('returns null when dropped back onto itself', () => {
    const visibleIds = ['a', 'b', 'c'];
    expect(resolveDragMove(visibleIds, 'b', 'b')).toBeNull();
  });

  it('throws when activeId is not in visibleIds, naming the id', () => {
    const visibleIds = ['a', 'b', 'c'];
    expect(() => resolveDragMove(visibleIds, 'zzz', 'b')).toThrow(/zzz/);
  });

  it('throws when overId is not in visibleIds, naming the id', () => {
    const visibleIds = ['a', 'b', 'c'];
    expect(() => resolveDragMove(visibleIds, 'a', 'zzz')).toThrow(/zzz/);
  });

  it('returns indices into visibleIds, not into the full order', () => {
    // Full order: a,b,c,d,e,f. Visible (filtered) view = b, d, f — a sparse subset.
    const visibleIds = ['b', 'd', 'f'];
    // In the full order b and f are at indices 1 and 5, but within visibleIds they are 0 and 2.
    expect(resolveDragMove(visibleIds, 'b', 'f')).toEqual({ fromIndex: 0, toIndex: 2 });
  });
});

describe('rankIndex', () => {
  it('is 1-based', () => {
    const index = rankIndex(['a', 'b', 'c']);
    expect(index.get('a')).toBe(1);
    expect(index.get('b')).toBe(2);
    expect(index.get('c')).toBe(3);
  });

  it('throws on a duplicate id', () => {
    expect(() => rankIndex(['a', 'b', 'a'])).toThrow();
  });
});

describe('rankDelta', () => {
  it('is positive when the player was promoted (your rank better than baseRank)', () => {
    expect(rankDelta(3, 10)).toBe(7);
  });

  it('is negative when the player was demoted (your rank worse than baseRank)', () => {
    expect(rankDelta(10, 3)).toBe(-7);
  });

  it('is zero when unmoved', () => {
    expect(rankDelta(5, 5)).toBe(0);
  });
});
