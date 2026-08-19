/**
 * Position filter tabs: All + QB/RB/WR/TE/K/DST, with per-position counts for the active
 * format. A position with zero players in the active format renders DISABLED (not hidden)
 * — Dynasty Superflex legitimately ranks no K or DST; that is data, not a load failure.
 */
import { isPosition, POSITION_FILTER_ALL, POSITIONS } from '@/domain';
import { getRankings, useBoardStore } from '@/state';
import { ToggleGroup, type ToggleGroupOption } from '@/ui';

export function PositionTabs() {
  const activeFormat = useBoardStore((state) => state.activeFormat);
  const position = useBoardStore((state) => state.position);

  const { countsByPosition } = getRankings(activeFormat);
  const totalCount = POSITIONS.reduce((sum, pos) => sum + countsByPosition[pos], 0);

  const options: ToggleGroupOption[] = [
    { value: POSITION_FILTER_ALL, label: 'All', count: totalCount },
    ...POSITIONS.map((pos) => ({
      value: pos,
      label: pos,
      count: countsByPosition[pos],
      disabled: countsByPosition[pos] === 0,
    })),
  ];

  function handleChange(value: string) {
    if (value === POSITION_FILTER_ALL || isPosition(value)) {
      useBoardStore.getState().setPosition(value);
      return;
    }
    throw new Error(`PositionTabs: unknown position filter "${value}"`);
  }

  return (
    <ToggleGroup label="Position" options={options} value={position} onChange={handleChange} />
  );
}
