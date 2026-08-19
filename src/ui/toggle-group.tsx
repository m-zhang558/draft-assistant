/**
 * Generic single-select segmented control. Renders the WAI-ARIA radiogroup pattern
 * (`role="radiogroup"` + `role="radio"` children) with roving focus: arrow keys both
 * move focus AND select, matching native radio button behaviour.
 */
import { useRef } from 'react';
import type { KeyboardEvent } from 'react';

export interface ToggleGroupOption {
  value: string;
  label: string;
  count?: number;
  disabled?: boolean;
}

export interface ToggleGroupProps {
  label: string;
  options: ReadonlyArray<ToggleGroupOption>;
  value: string;
  onChange: (value: string) => void;
}

export function ToggleGroup({ label, options, value, onChange }: ToggleGroupProps) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const selectedIndex = options.findIndex((option) => option.value === value);
  const rovingIndex =
    selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);

  function selectAndFocus(index: number) {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    buttonRefs.current[index]?.focus();
  }

  function moveFocus(fromIndex: number, direction: 1 | -1) {
    const count = options.length;
    if (count === 0) return;
    let index = fromIndex;
    for (let step = 0; step < count; step += 1) {
      index = (index + direction + count) % count;
      const candidate = options[index];
      if (candidate && !candidate.disabled) {
        selectAndFocus(index);
        return;
      }
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(index, 1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(index, -1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
    >
      {options.map((option, index) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            tabIndex={index === rovingIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={[
              'rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
              'disabled:cursor-not-allowed disabled:opacity-40',
              selected
                ? 'bg-accent text-accent-contrast'
                : 'text-text-primary hover:bg-surface-muted',
            ].join(' ')}
          >
            {option.label}
            {option.count !== undefined ? (
              <span aria-hidden="true" className="ml-1 opacity-70">
                {option.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
