/**
 * Core domain model for Fantasy Assist. Pure TypeScript: no React, no I/O, no imports
 * from higher layers (state/features/ui/app/data). See PROJECT.md §5.
 */

/** Positions in the order they should be displayed (position tabs, filters, etc.). */
export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DST'] as const satisfies readonly string[];

export type Position = (typeof POSITIONS)[number];

/** Supported ranking formats. */
export const FORMATS = ['redraft-ppr', 'dynasty-sf'] as const satisfies readonly string[];

export type Format = (typeof FORMATS)[number];

const POSITION_SET: ReadonlySet<string> = new Set(POSITIONS);
const FORMAT_SET: ReadonlySet<string> = new Set(FORMATS);

/** Narrows an unknown value to a valid {@link Position}. */
export function isPosition(value: unknown): value is Position {
  return typeof value === 'string' && POSITION_SET.has(value);
}

/** Narrows an unknown value to a valid {@link Format}. */
export function isFormat(value: unknown): value is Format {
  return typeof value === 'string' && FORMAT_SET.has(value);
}

export interface Player {
  /** Stable across datasets and formats. */
  id: string;
  name: string;
  position: Position;
  team: string;
  /** As published by the source — never mutated by user customization. */
  baseRank: number;
  tier?: number;
  byeWeek?: number;
  /** Dynasty-relevant. */
  age?: number;
}

export interface BoardState {
  format: Format;
  /** Player ids — YOUR ranking; the source of truth for display. */
  order: string[];
  /** Crossed-off player ids. */
  drafted: Set<string>;
}
