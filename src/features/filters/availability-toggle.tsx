/** "Available only" checkbox — hides drafted players. Available-only is the default (MVP 2.4). */
import { useBoardStore } from '@/state';

export function AvailabilityToggle() {
  const availableOnly = useBoardStore((state) => state.availableOnly);

  return (
    <label className="flex items-center gap-2 text-sm text-text-primary">
      <input
        type="checkbox"
        checked={availableOnly}
        onChange={(event) => useBoardStore.getState().setAvailableOnly(event.target.checked)}
        className="h-4 w-4 rounded border-border accent-accent"
      />
      Available only
    </label>
  );
}
