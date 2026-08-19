/**
 * Light / Dark / System theme switcher. Self-sufficient: reads and writes `theme` on the
 * board store directly, same pattern as `features/format/format-switch.tsx`.
 */
import { THEMES, isTheme, useBoardStore } from '@/state';
import { ToggleGroup } from '@/ui';
import { THEME_LABELS } from './preference-labels';

const THEME_OPTIONS = THEMES.map((theme) => ({ value: theme, label: THEME_LABELS[theme] }));

export function ThemeToggle() {
  const theme = useBoardStore((state) => state.theme);

  function handleChange(value: string) {
    if (isTheme(value)) {
      useBoardStore.getState().setTheme(value);
      return;
    }
    throw new Error(`ThemeToggle: unknown theme "${value}"`);
  }

  return (
    <ToggleGroup label="Theme" options={THEME_OPTIONS} value={theme} onChange={handleChange} />
  );
}
