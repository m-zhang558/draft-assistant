/**
 * Global keyboard shortcuts for undo/redo (MVP 3.1): Ctrl/Cmd+Z to undo, Ctrl/Cmd+Shift+Z or
 * Ctrl/Cmd+Y to redo (the Windows convention). A single `window` `keydown` listener, installed
 * once and torn down on unmount — not attached per-row or per-button, since the shortcut must
 * fire regardless of what currently has focus.
 *
 * Text fields are deliberately exempt: a keystroke aimed at an `<input>`, `<textarea>`,
 * `<select>`, or any `contentEditable` element is left alone so the browser's native text-undo
 * still works there instead of being hijacked by the board's history.
 */
import { useEffect } from 'react';

export interface UseHistoryShortcutsOptions {
  onUndo: () => void;
  onRedo: () => void;
}

function isTextFieldTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/** Installs the window-level undo/redo keyboard shortcuts described in the file header. */
export function useHistoryShortcuts({ onUndo, onRedo }: UseHistoryShortcutsOptions): void {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isTextFieldTarget(event.target)) {
        return;
      }

      const isModified = event.ctrlKey || event.metaKey;
      if (!isModified) {
        return;
      }

      const key = event.key.toLowerCase();

      if (key === 'z' && !event.shiftKey) {
        event.preventDefault();
        onUndo();
        return;
      }

      if ((key === 'z' && event.shiftKey) || key === 'y') {
        event.preventDefault();
        onRedo();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onUndo, onRedo]);
}
