/**
 * Comfortable / Compact row-density switcher. Self-sufficient: reads and writes `density` on
 * the board store directly, same pattern as `features/format/format-switch.tsx`. This pass
 * ships only the control — pass 3 makes the board rows respond to `density`.
 */
import { DENSITIES, isDensity, useBoardStore } from '@/state';
import { ToggleGroup } from '@/ui';
import { DENSITY_LABELS } from './preference-labels';

const DENSITY_OPTIONS = DENSITIES.map((density) => ({
  value: density,
  label: DENSITY_LABELS[density],
}));

export function DensityToggle() {
  const density = useBoardStore((state) => state.density);

  function handleChange(value: string) {
    if (isDensity(value)) {
      useBoardStore.getState().setDensity(value);
      return;
    }
    throw new Error(`DensityToggle: unknown density "${value}"`);
  }

  return (
    <ToggleGroup
      label="Row density"
      options={DENSITY_OPTIONS}
      value={density}
      onChange={handleChange}
    />
  );
}
