/**
 * Human-readable names for `Theme` and `Density`. Its own module so that `theme-toggle.tsx`
 * and `density-toggle.tsx` each export only a component — a file mixing component and
 * constant exports degrades React Fast Refresh granularity
 * (`react-refresh/only-export-components`), and PROJECT.md §7 requires lint to be clean of
 * warnings as well as errors. Mirrors `features/format/format-labels.ts`.
 */
import type { Density, Theme } from '@/state';

export const THEME_LABELS: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

export const DENSITY_LABELS: Record<Density, string> = {
  comfortable: 'Comfortable',
  compact: 'Compact',
};
