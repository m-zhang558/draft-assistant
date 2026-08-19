/**
 * Redraft PPR <-> Dynasty Superflex switcher. Self-sufficient: reads and writes
 * `activeFormat` on the board store directly so `App` stays a pure layout shell.
 */
import { FORMATS, isFormat } from '@/domain';
import { useBoardStore } from '@/state';
import { ToggleGroup } from '@/ui';
import { FORMAT_LABELS } from './format-labels';

const FORMAT_OPTIONS = FORMATS.map((format) => ({ value: format, label: FORMAT_LABELS[format] }));

export function FormatSwitch() {
  const format = useBoardStore((state) => state.activeFormat);

  function handleChange(value: string) {
    if (isFormat(value)) {
      useBoardStore.getState().setFormat(value);
      return;
    }
    throw new Error(`FormatSwitch: unknown format "${value}"`);
  }

  return (
    <ToggleGroup
      label="Ranking format"
      options={FORMAT_OPTIONS}
      value={format}
      onChange={handleChange}
    />
  );
}
