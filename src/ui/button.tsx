/**
 * Generic button primitive. Knows nothing about players, boards, or any other domain
 * concept — see PROJECT.md §5 (`ui/` is generic presentational primitives only).
 */
import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'border border-transparent bg-accent text-accent-contrast hover:opacity-90',
  secondary: 'border border-border bg-surface text-text-primary hover:bg-surface-muted',
  ghost: 'border border-transparent bg-transparent text-text-primary hover:bg-surface-muted',
  danger: 'border border-danger bg-transparent text-danger hover:bg-surface-muted',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2 py-1 text-xs',
  md: 'px-3 py-2 text-sm',
};

export function Button({ variant = 'secondary', size = 'md', className, ...props }: ButtonProps) {
  const classes = [
    'inline-flex items-center justify-center gap-1 rounded-md font-medium transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'disabled:cursor-not-allowed disabled:opacity-50',
    VARIANT_CLASSES[variant],
    SIZE_CLASSES[size],
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return <button className={classes} {...props} />;
}
