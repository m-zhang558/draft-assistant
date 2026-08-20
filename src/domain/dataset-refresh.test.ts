import { reconcileOrder } from './board';
import { reconcileWithReport } from './dataset-refresh';
import type { Player } from './player';

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

describe('reconcileWithReport', () => {
  it('reports no change when the persisted order already matches the dataset exactly', () => {
    const players = [player('a', 1), player('b', 2), player('c', 3)];
    const { order, report } = reconcileWithReport(['a', 'b', 'c'], players);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(report).toEqual({ added: [], removed: [], duplicates: [], changed: false });
  });

  it('reports removed ids that are no longer in the dataset', () => {
    const players = [player('a', 1), player('b', 2)];
    const { report } = reconcileWithReport(['a', 'zzz', 'b'], players);
    expect(report.removed).toEqual(['zzz']);
    expect(report.added).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.changed).toBe(true);
  });

  it('reports a removed id only once even if it was persisted twice', () => {
    const players = [player('a', 1)];
    const { report } = reconcileWithReport(['a', 'zzz', 'zzz'], players);
    expect(report.removed).toEqual(['zzz']);
  });

  it('reports duplicate ids that appeared more than once', () => {
    const players = [player('a', 1), player('b', 2)];
    const { report } = reconcileWithReport(['a', 'b', 'a'], players);
    expect(report.duplicates).toEqual(['a']);
    expect(report.removed).toEqual([]);
    expect(report.added).toEqual([]);
    expect(report.changed).toBe(true);
  });

  it('reports a duplicate only once even if it was persisted three times', () => {
    const players = [player('a', 1)];
    const { report } = reconcileWithReport(['a', 'a', 'a'], players);
    expect(report.duplicates).toEqual(['a']);
  });

  it('reports added players ascending by baseRank', () => {
    const players = [player('a', 1), player('new-hi', 5), player('new-lo', 2), player('b', 3)];
    const { report } = reconcileWithReport(['a', 'b'], players);
    expect(report.added.map((p) => p.id)).toEqual(['new-lo', 'new-hi']);
    expect(report.removed).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.changed).toBe(true);
  });

  it('a cold start (empty persisted order) reports every player as added and changed: true', () => {
    const players = [player('a', 1), player('b', 2)];
    const { order, report } = reconcileWithReport([], players);
    expect(order).toEqual(['a', 'b']);
    expect(report.added.map((p) => p.id)).toEqual(['a', 'b']);
    expect(report.removed).toEqual([]);
    expect(report.duplicates).toEqual([]);
    expect(report.changed).toBe(true);
  });

  it('agrees with reconcileOrder on a non-trivial input mixing removed, duplicate, and added ids', () => {
    // Persisted: a, b(duplicate), zzz(removed), b, c. Dataset drops zzz, adds "new" at baseRank 2.5.
    const persisted = ['a', 'b', 'zzz', 'b', 'c'];
    const players = [player('a', 1), player('b', 2), player('c', 4), player('new', 3)];

    const { order, report } = reconcileWithReport(persisted, players);
    expect(order).toEqual(reconcileOrder(persisted, players));
    expect(report.removed).toEqual(['zzz']);
    expect(report.duplicates).toEqual(['b']);
    expect(report.added.map((p) => p.id)).toEqual(['new']);
    expect(report.changed).toBe(true);
  });

  it('does not mark changed when the only difference is a harmless no-op reconcile', () => {
    const players = [player('c', 3), player('a', 1), player('b', 2)];
    const { report } = reconcileWithReport(['a', 'b', 'c'], players);
    expect(report.changed).toBe(false);
  });
});
