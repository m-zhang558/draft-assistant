# Phase 2 — Core interactivity

Status: **done**, verified on the main thread rather than taken from agent self-reports. You can
now reorder, cross off, filter, search, switch formats, and refresh the page with every edit
intact — the done-when criteria in `docs/MVP-OVERVIEW/MVP-OVERVIEW.md`.

This is the phase where Fantasy Assist stops being a rendered list and becomes the thing you
keep open on a second monitor.

## What shipped

All ten MVP items, plus the reconciliation work item 2.2 turned out to require.

| # | Item | Where it lives |
|---|---|---|
| 2.1 | Board store | `state/board-store.ts` |
| 2.2 | Persistence | `state/persistence.ts` + `domain/board.ts` `reconcileOrder` |
| 2.3 | Cross off | `features/board/player-row.tsx` |
| 2.4 | Availability filter | `features/filters/availability-toggle.tsx`, `domain/filters.ts` |
| 2.5 | Reorder | `features/board/board.tsx` (dnd-kit) + `domain/board.ts` `moveInFilteredView` / `resolveDragMove` |
| 2.6 | Rank display | `domain/board.ts` `rankIndex` / `rankDelta`, rendered in `player-row.tsx` |
| 2.7 | Position filter | `features/filters/position-tabs.tsx` |
| 2.8 | Format switch | `features/format/format-switch.tsx` |
| 2.9 | Search | `features/filters/search-box.tsx`, `domain/filters.ts` `matchesSearch` |
| 2.10 | Reset | `features/board/board-actions.tsx` + `ui/confirm-button.tsx` |

## The decision that carries the phase

**Reordering inside a filtered view is a pure function, not drag-handler logic.** The MVP plan
called this out as a design note; it is the one piece of Phase 2 that is genuinely easy to get
subtly wrong, and wrong here means silently scrambling a board mid-draft.

`domain/board.ts`:

```ts
moveInFilteredView(order, visibleIds, fromIndex, toIndex): string[]
```

It takes the full-order **slots** occupied by the visible ids, reorders the visible list, and
writes it back into those same slots. Hidden players therefore never change index — not
approximately, exactly. It is unit-tested by asserting on the whole array, including explicit
assertions that each hidden id sits at its original index.

It also **throws `RangeError`** on an out-of-bounds index, on `visibleIds` that is not a subset
of `order`, and on `visibleIds` that is not in the same relative order as `order`. A desynced
view is a bug; papering over it would move the wrong player and look like it worked.

**One consequence worth knowing:** because a stale visible-id list is *usually still a valid
in-order subset*, that throw would not catch staleness. So the interaction handlers in
`board.tsx` derive the visible ids from store state at call time instead of closing over the
rendered array. That is one pass over ~440 ids per discrete gesture — far cheaper than the class
of bug it removes.

## Persistence, and the fail-fast line

One key, `fantasy-assist.state`, schema-versioned at `1`. Written only by
`state/persistence.ts`. Documented in `PROJECT.md` §5.

The interesting question was where "fail fast" actually applies. The answer we settled on:

- **Absent key → `null`, cold start.** An empty localStorage is not a broken state, it's a first
  visit. Throwing here would be dogma, not rigour.
- **Present but corrupt → throws `PersistedStateError` naming the key.** Unparseable JSON, an
  unknown `schemaVersion`, a missing format, a bad `filters.position`, a non-array `order` — all
  throw. Silently discarding a half-valid board would throw away exactly the customization the
  app exists to preserve, and it would do it quietly.

**`search` is deliberately not persisted.** A search box still holding `mahomes` after a refresh
mid-draft hides the board for no reason. Position and availability do persist.

### `reconcileOrder` had to land now

A persisted `order` is a list of ids captured against one dataset and replayed against another.
Re-running `npm run fetch:rankings` changes the dataset; without reconciliation the board renders
wrong. So `domain/board.ts` reconciles at load: unknown ids dropped, duplicates collapsed, new
players inserted at the position implied by their `baseRank`, **your customization preserved**.

This is the minimal correctness-driven version of MVP item **4.12**, which shrinks accordingly —
4.12 becomes the reporting and edge-case work, not the whole mechanism.

## Deviations to flag

**1. The board is a `<ul>` grid, not Phase 1's `<table>`.** dnd-kit applies CSS transforms to the
dragged element, and transforms on `<tr>` are unreliable across browsers. `features/board/
player-list.tsx` was deleted and replaced by `board.tsx` + `player-row.tsx`, laid out on a shared
CSS grid template (`row-grid.ts`) with a column legend above the list. No new directories.

**2. MVP 2.5 says "↑/↓ on a focused row"; the shipped shortcut is Alt+↑/↓.** Bare arrows are
already claimed twice over — by dnd-kit's `KeyboardSensor` once a row is lifted, and by browser
scrolling. Keyboard reordering therefore has two paths, both working:

- the drag handle button is the dnd-kit keyboard activator (Space to lift, arrows, Space to drop);
- Alt+↑ / Alt+↓ on a focused row moves it directly, one step.

**3. `state/board-store.ts` guards its persistence write.** The store subscribes to itself, but
`search` is not persisted, so an unguarded subscription would re-serialize ~865 player ids on
every keystroke. The subscription compares the identity of the fields that actually round-trip and
returns early otherwise.

**4. Every feature component reads the store directly and takes no props.** `App.tsx` is a pure
layout shell with no prop-drilling. This is a stronger reading of "no business logic in App" than
threading eight pieces of store state through it.

**5. `FORMAT_LABELS` and `ROW_GRID` live in their own modules.** Exporting a constant alongside a
component from the same file degrades React Fast Refresh and trips
`react-refresh/only-export-components`. `PROJECT.md` §7 requires lint clean of **warnings** as
well as errors, so they were extracted rather than suppressed.

## Empty positions are data, not failure

Dynasty Superflex ranks **no kickers and no defences** — upstream simply doesn't. `PROJECT.md` §3
flagged this as a Phase 2.7 requirement and it is handled in three places:

- `countByPosition` always returns every `Position` key, `0` when absent — a missing key would be
  indistinguishable from a bug.
- The K and DST tabs render **disabled with their `0` count**, not hidden. Hiding them would make
  the format switch look like it broke something.
- `setFormat` falls back to the "All" tab if the currently selected position has zero players in
  the format being switched to, so you can never land on a blank board.

The board's empty state distinguishes all three reasons a list can be empty: this format doesn't
rank this position / everyone matching is drafted (with the fix: turn off "Available only") / no
search match.

## Verification

Re-run on the main thread after implementation:

| Command | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | clean — **0 errors, 0 warnings** |
| `npm run test` | `Test Files 13 passed (13)` / `Tests 140 passed (140)` |
| `npm run build` | 68 modules, 12.41 kB CSS / 361.73 kB JS (103.03 kB gzip) |
| `npx prettier --check .` | clean |
| `npm run dev` | Vite ready in 141 ms; `curl localhost:5173` → HTTP 200 |

Test count went from 50 (Phase 1) to 140, distributed deliberately:

| Where | Tests | What it covers |
|---|---|---|
| `domain/` | 61 | Reordering, reconciliation, filtering — pure functions, no DOM |
| `state/` | 24 | Store behaviour, persistence round-trip, corrupt-state throws |
| `data/sources/` | 20 | Dataset validation (Phase 1) |
| `tests/` | 22 | Dataset integrity (15) + board integration (7) |
| `ui/` + `features/` + `app/` | 13 | Interaction, not markup |

The weighting is the point: the logic that can silently corrupt a board lives in `domain/` and is
tested there, where it needs no DOM and runs in 11 ms.

### jsdom, pointer drags, and why there is no Playwright

`jsdom` — the in-Node DOM implementation Vitest runs against — implements the DOM *tree* but does
**no layout**, so `getBoundingClientRect()` returns all zeros for every element. dnd-kit's pointer
dragging is geometric (`closestCenter` compares rectangles), so in jsdom all 426 rows report the
same position and a simulated drag either does nothing or resolves arbitrarily. **A real pointer
drag cannot be tested here**, and a test that appeared to pass would be passing for the wrong
reason.

The initial reaction was to reach for Playwright. On inspection that was overkill, and
`PROJECT.md` §4 now records the decision to **drop** browser automation rather than defer it. The
cheaper fix closed the actual gap:

`handleDragEnd` was the only reordering code with no test. Its job is pure translation — turning
dnd-kit's vocabulary (`active.id`, `over.id`) into the store's (`fromIndex`, `toIndex`) — with no
dependence on dnd-kit's runtime behaviour. So it moved into the domain layer as
`resolveDragMove(visibleIds, activeId, overId)`, covered by 7 tests including a sparse-`visibleIds`
case proving the returned indices are into the *filtered view*, not the full order. `handleDragEnd`
is now four lines that handle only the `null` no-op.

**This deliberately changed behaviour.** The old handler did `if (fromIndex === -1 || toIndex ===
-1) return;` — a silent fallback masking a desynced view, which §6 forbids. `resolveDragMove`
throws instead, matching `moveInFilteredView`'s existing contract for the same class of bug.

What remains untested is only dnd-kit's own pointer machinery, which is the library's
responsibility, not ours. Phase 3.7's frame-timing question is a measurement for Chrome's
Performance panel, not an assertion for a test suite.

## Defects found and fixed during verification

1. **One ESLint warning survived the implementing agent** (`react-refresh/only-export-components`
   on `format-switch.tsx`). `PROJECT.md` §7 specifies zero warnings, so `FORMAT_LABELS` was moved
   to `format-labels.ts` rather than accepted. Same fix later applied to `ROW_GRID`.
2. **Drag handlers closed over a `useRef` synced in a `useEffect`.** Correct in practice, but
   staleness here fails *silently* (see above). Replaced with a store-derived read at call time;
   the ref and its effect are gone.
3. **The board shipped with ten unlabeled columns** — tier, bye, age and the rank delta rendered
   as bare numbers or `—` with no header, a usability regression from Phase 1's `<table>`. Added
   an `aria-hidden` column legend (rows carry their own accessible labels, so announcing the
   legend per row would only add noise).
4. **Per-keystroke localStorage writes** in the store subscription. Guarded.

## Known limitations, and where they get addressed

- **No virtualisation.** All 426/439 rows mount, each with a `useSortable` hook. Usable, but this
  is the phase's main performance debt and Phase 3.7 is where it's paid — already marked
  **required, not optional** since Dynasty SF is 439 players.
- **`aria-label` on the `<li>`** conveys the Alt+↑/↓ affordance but overrides the row's content as
  its accessible name. A deliberate trade for discoverability; Phase 3.6's accessibility pass is
  the right place to re-examine it, likely with a live region.
- **No undo.** A misclick is fixed by clicking again (cross-off toggles) or by Alt+arrow-ing back.
  Phase 3.1 is the real safety net. Phase 2's store replaces `order` and `drafted` rather than
  mutating them, so a snapshot is a shallow copy — 3.1 should be cheap.
- **Bundle grew 301 → 362 kB** (82.5 → 103 kB gzip) from zustand + dnd-kit. Acceptable; the
  datasets still dominate, and the `RankingSource` seam is where lazy-loading would go.

## Deliberately left out

- Undo/redo, motion, tier bands, dark mode, responsive layout, virtualisation, export/import
  (all Phase 3).
- SQLite, notes, watchlist, multiple boards (Phase 4).
- Any change to `src/data/rankings/*.json` or the generator — untouched this phase, per
  `PROJECT.md` §8.
