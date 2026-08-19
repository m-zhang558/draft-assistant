/**
 * A single ranked player row. Memoized: with 400+ rows in the dataset (even windowed down to
 * ~20-30 mounted at once), `Board` must select primitive props here (never fresh
 * objects/arrays) and keep `onToggleDrafted` / `onMove` referentially stable, or memoization is
 * defeated. Virtualisation makes this matter more, not less: every scroll frame mounts/unmounts
 * rows at the window's edges, and an unstable prop would force every mounted row to re-render
 * on every scroll tick on top of that churn.
 *
 * `data-player-id` on the `<li>` is how `board.tsx` finds a specific row's live DOM node to
 * restore focus after a move — via `querySelector` inside an effect, not a per-row ref-callback
 * prop threaded down from the parent (see `board.tsx` for why that shape trips
 * `eslint-plugin-react-hooks`'s ref-safety analysis).
 *
 * Draggable via `useSortable` — the drag handle button below is the dnd-kit keyboard
 * activator (Space to lift, arrow keys to move, Space to drop; dnd-kit supplies its own
 * `aria-roledescription` and instructions via `attributes`, left untouched here). Alt+ArrowUp /
 * Alt+ArrowDown on the row itself is a direct move shortcut (see board.tsx for why Alt is used
 * instead of bare arrows) — its affordance is attached via `aria-describedby`, pointing at the
 * ONE shared instructions paragraph `board.tsx` renders for the whole list, not a per-row copy.
 *
 * Positioning (MVP 3.7): absolutely positioned at `top: index * rowHeight` with an explicit
 * `height`, rather than relying on document flow + a spacer element — see `board.tsx` for why.
 * dnd-kit's drag transform composes on top of this via `CSS.Transform.toString`, unaffected by
 * the position being absolute rather than static.
 *
 * Tier bands (MVP 3.3): `isTierStart` renders a heavier top border plus an emphasised Tier
 * cell — never a separate row, and never colour alone (PROJECT.md §6). Border width only
 * changes how much of the fixed-height box's content area the border eats into (box-sizing:
 * border-box, Tailwind's default), so it cannot change the row's height.
 *
 * Motion (MVP 3.2): dnd-kit's reorder transition is JS-driven, so `tokens.css`'s
 * `prefers-reduced-motion` block cannot reach it — `useReducedMotion` disables it directly.
 * The cross-off colour/opacity shift gets a short (`duration-150`, under the "pick clock" 150ms
 * budget) CSS transition so it reads as a state change rather than a repaint.
 *
 * Drafted state is conveyed by text decoration (line-through) and `aria-pressed` on the
 * toggle — never by colour alone.
 */
import { memo, type CSSProperties, type KeyboardEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Player } from '@/domain';
import { useReducedMotion } from '@/ui';
import { NARROW_HIDDEN, ROW_GRID } from './row-grid';

export interface PlayerRowProps {
  player: Player;
  /** 1-based rank in your current order (not the filtered view). */
  rank: number;
  /** baseRank - yourRank: positive = promoted, negative = demoted, 0 = unmoved. */
  delta: number;
  drafted: boolean;
  /** This row's position within the (filtered, ordered) visible list — for absolute placement. */
  index: number;
  /** Fixed row height in CSS px; must match the virtualiser's arithmetic (`row-grid.ts`). */
  rowHeight: number;
  /** True when this row starts a new tier band (MVP 3.3). Never true and untiered together. */
  isTierStart: boolean;
  /** `id` of the single shared keyboard-move instructions paragraph rendered once by Board. */
  instructionsId: string;
  onToggleDrafted: (playerId: string) => void;
  onMove: (playerId: string, direction: -1 | 1) => void;
}

function buildRowLabel(player: Player, rank: number, drafted: boolean): string {
  const segments = [`${player.name}, rank ${rank}`, player.position, player.team];
  if (player.byeWeek !== undefined) {
    segments.push(`bye ${player.byeWeek}`);
  }
  if (player.tier !== undefined) {
    segments.push(`tier ${player.tier}`);
  }
  if (drafted) {
    segments.push('drafted');
  }
  return `${segments.join(', ')}.`;
}

function PlayerRowComponent({
  player,
  rank,
  delta,
  drafted,
  index,
  rowHeight,
  isTierStart,
  instructionsId,
  onToggleDrafted,
  onMove,
}: PlayerRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: player.id,
  });
  const reducedMotion = useReducedMotion();

  const style: CSSProperties = {
    position: 'absolute',
    top: index * rowHeight,
    left: 0,
    right: 0,
    height: rowHeight,
    transform: CSS.Transform.toString(transform),
    transition: reducedMotion ? undefined : transition,
    zIndex: isDragging ? 10 : undefined,
  };

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (!event.altKey) return;
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      onMove(player.id, -1);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      onMove(player.id, 1);
    }
  }

  const deltaLabel = delta > 0 ? `▲${delta}` : delta < 0 ? `▼${Math.abs(delta)}` : null;
  const deltaColorClass =
    delta > 0 ? 'text-success' : delta < 0 ? 'text-danger' : 'text-text-muted';

  return (
    <li
      ref={setNodeRef}
      data-player-id={player.id}
      style={style}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={buildRowLabel(player, rank, drafted)}
      aria-describedby={instructionsId}
      className={[
        ROW_GRID,
        'border-b border-border px-3 text-sm outline-none transition-colors duration-150',
        'focus-visible:bg-surface-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent',
        isTierStart ? 'border-t-4 border-t-accent' : '',
        isDragging ? 'bg-surface-muted opacity-70' : 'bg-surface',
        drafted ? 'text-text-muted' : 'text-text-primary',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <button
        type="button"
        aria-label={`Reorder ${player.name}`}
        className="cursor-grab touch-none rounded p-1 text-text-muted hover:bg-surface-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        ⠿
      </button>
      <span className="font-mono text-text-primary">{rank}</span>
      <span className={drafted ? 'truncate line-through' : 'truncate'}>{player.name}</span>
      <span className="text-xs font-medium text-text-muted">{player.position}</span>
      <span className={`text-xs text-text-muted ${NARROW_HIDDEN}`}>{player.team}</span>
      <span
        className={`text-xs text-text-muted ${NARROW_HIDDEN} ${isTierStart ? 'font-bold text-accent' : ''}`}
      >
        {player.tier ?? '—'}
      </span>
      <span className={`text-xs text-text-muted ${NARROW_HIDDEN}`}>{player.byeWeek ?? '—'}</span>
      <span className={`text-xs text-text-muted ${NARROW_HIDDEN}`}>{player.age ?? '—'}</span>
      <span className={`text-xs font-medium ${NARROW_HIDDEN} ${deltaColorClass}`}>
        {deltaLabel ?? ''}
      </span>
      <button
        type="button"
        aria-pressed={drafted}
        aria-label={drafted ? `Mark ${player.name} available` : `Mark ${player.name} drafted`}
        onClick={() => onToggleDrafted(player.id)}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:bg-surface-muted max-sm:min-h-11 max-sm:min-w-11"
      >
        {drafted ? 'Undo' : 'Draft'}
      </button>
    </li>
  );
}

export const PlayerRow = memo(PlayerRowComponent);
