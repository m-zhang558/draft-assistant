/**
 * "Reset to expert rankings" and "Clear drafted" — both gated behind the two-step
 * `ConfirmButton`, never `window.confirm` (MVP 2.10). Undo/Redo (MVP 3.1) sit alongside them as
 * plain `Button`s — deliberately NOT confirmed, since a two-step confirmation on the misclick
 * safety net itself would defeat the point of having one.
 *
 * Self-sufficient: reads the store's stable action references and `canUndo`/`canRedo` directly.
 */
import { useCallback, useState } from 'react';
import { useBoardStore } from '@/state';
import { Button, ConfirmButton, LiveRegion } from '@/ui';
import { useHistoryShortcuts } from './use-history-shortcuts';

export function BoardActions() {
  const canUndo = useBoardStore((state) => state.canUndo);
  const canRedo = useBoardStore((state) => state.canRedo);
  const [announcement, setAnnouncement] = useState('');

  // Decide the announcement from canUndo/canRedo BEFORE calling undo()/redo(): this is what
  // lets a keyboard shortcut fired with an empty stack still announce something ("Nothing to
  // undo.") instead of going silent, since the store's own action is a silent no-op by design.
  const handleUndo = useCallback(() => {
    const couldUndo = useBoardStore.getState().canUndo;
    useBoardStore.getState().undo();
    setAnnouncement(couldUndo ? 'Undo: board restored.' : 'Nothing to undo.');
  }, []);

  const handleRedo = useCallback(() => {
    const couldRedo = useBoardStore.getState().canRedo;
    useBoardStore.getState().redo();
    setAnnouncement(couldRedo ? 'Redo: board restored.' : 'Nothing to redo.');
  }, []);

  useHistoryShortcuts({ onUndo: handleUndo, onRedo: handleRedo });

  return (
    <div className="flex items-center gap-2">
      <Button onClick={handleUndo} disabled={!canUndo} variant="secondary" size="sm">
        Undo (Ctrl+Z)
      </Button>
      <Button onClick={handleRedo} disabled={!canRedo} variant="secondary" size="sm">
        Redo (Ctrl+Shift+Z)
      </Button>
      <ConfirmButton
        label="Reset to expert rankings"
        confirmLabel="Confirm reset?"
        onConfirm={() => useBoardStore.getState().resetOrder()}
        variant="secondary"
        size="sm"
      />
      <ConfirmButton
        label="Clear drafted"
        confirmLabel="Confirm clear?"
        onConfirm={() => useBoardStore.getState().clearDrafted()}
        variant="secondary"
        size="sm"
      />
      <LiveRegion message={announcement} label="History status" />
    </div>
  );
}
