/**
 * Human-readable names for each `Format`. Its own module so that `format-switch.tsx` exports
 * only a component — a file mixing component and constant exports degrades React Fast Refresh
 * granularity (`react-refresh/only-export-components`), and PROJECT.md §7 requires lint to be
 * clean of warnings as well as errors.
 */
import type { Format } from '@/domain';

export const FORMAT_LABELS: Record<Format, string> = {
  'redraft-ppr': 'Redraft PPR',
  'dynasty-sf': 'Dynasty Superflex',
};
