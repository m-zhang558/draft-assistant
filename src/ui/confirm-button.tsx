/**
 * Two-step confirmation button: first click "arms" the button and swaps its label to
 * `confirmLabel`; a second click fires `onConfirm`. Losing focus or pressing Escape
 * disarms it without firing. This is what satisfies MVP 2.10 ("both confirmed") without
 * ever reaching for `window.confirm`.
 */
import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Button, type ButtonSize, type ButtonVariant } from './button';

export interface ConfirmButtonProps {
  label: string;
  confirmLabel: string;
  onConfirm: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function ConfirmButton({
  label,
  confirmLabel,
  onConfirm,
  variant = 'secondary',
  size = 'md',
}: ConfirmButtonProps) {
  const [armed, setArmed] = useState(false);

  function handleClick() {
    if (armed) {
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
  }

  function handleBlur() {
    setArmed(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'Escape') {
      setArmed(false);
    }
  }

  return (
    <Button
      type="button"
      variant={armed ? 'danger' : variant}
      size={size}
      onClick={handleClick}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {armed ? confirmLabel : label}
    </Button>
  );
}
