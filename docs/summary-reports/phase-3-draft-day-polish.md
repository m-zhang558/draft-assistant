# Phase 3 — Draft-day polish

Status: **done**, verified on the main thread rather than taken from agent self-reports. All
eight items shipped. This completes the MVP: Phases 0–3 are the product, and Phase 4 is a
deliberate "only after a real draft" decision.

Phase 2 made the board usable. Phase 3 makes it usable *under a 60-second pick clock, at night,
by someone who just misclicked* — which is a different requirement, and the reason undo,
virtualisation and the accessibility rework are in the same phase rather than scattered.

## What shipped

| # | Item | Where it lives |
|---|---|---|
| 3.1 | Undo / redo | `domain/history.ts`, store `undo`/`redo`/`canUndo`/`canRedo`, `features/board/board-actions.tsx` + `use-history-shortcuts.ts` |
| 3.2 | Motion | `tokens.css` (CSS half) + `ui/use-reduced-motion.ts` (dnd-kit half), applied in `player-row.tsx` |
| 3.3 | Tier bands | `domain/tiers.ts` `tierStartIds`, rendered in `player-row.tsx` |
| 3.4 | Density + dark mode | `features/preferences/`, `tokens.css` dark palette, `row-grid.ts` `resolveRowHeight` |
| 3.5 | Responsive | `app/App.tsx` shell, `row-grid.ts` narrow/`sm:` column templates |
| 3.6 | Accessibility pass | Row labels + one shared instructions node, `ui/live-region.tsx`, contrast audit in `tokens.css` |
| 3.7 | Performance | `features/board/virtual-window.ts` (pure) + `use-virtual-rows.ts` (DOM) |
| 3.8 | Export / import | `state/persistence.ts` `serializeState`/`parseStateJson`, `features/board/board-io.tsx` |

## The decisions that carry the phase

### Virtualisation is hand-rolled, and the maths is a pure function

439 Dynasty SF rows each mounting a `useSortable` hook was Phase 2's headline debt. The fix is
~100 lines split deliberately in two:

- `virtual-window.ts` — `computeWindow({scrollTop, viewportHeight, rowHeight, rowCount, overscan})`
  returns an inclusive index range. Pure, synchronous, 8 unit tests covering the empty list, a
  list shorter than the viewport, both overscan clamps, scrolled-to-bottom, and a `scrollTop`
  past the end.
- `use-virtual-rows.ts` — the DOM half: container ref, scroll listener throttled to one
  `requestAnimationFrame`, viewport height from `clientHeight` on mount and window `resize`.

**No new dependency.** Fixed-height windowing over one scroll container is small enough to own,
and the hard part is not the maths — it is where windowing meets dnd-kit, which a library would
obscure rather than solve. This is the same judgement `PROJECT.md` §4 applied when it dropped
Playwright.

**No `ResizeObserver`**: jsdom does not implement it, and a window `resize` listener covers
every case that actually changes this container's height.

Rows are **absolutely positioned** inside a `<ul>` sized to the full list height, rather than
padded with spacer `<li>`s. Spacers would pollute `getAllByRole('listitem')` and the list's
screen-reader semantics, and would need their own height bookkeeping — one more place the
arithmetic could disagree with the CSS.

Two consequences worth knowing:

- `SortableContext`'s `items` stays the **full** `visibleIds` list, never the rendered window.
  Give dnd-kit only what is mounted and reordering desyncs the moment you drag past the edge.
- `restrictToParentElement` was replaced by `restrictToFirstScrollableAncestor`. Under
  virtualisation the "parent" is a sliver tracking only mounted rows, so the old modifier would
  pin a drag to the visible window.

Evidence it works: the test suite went from **8.75s to ~3.3s**, and the two heaviest files
dropped from 1.2–2.7s per test to under 500ms. Only a fraction of rows now mount, and a test
asserts the rendered row count is both `> 0` and `< 426`.

### Row height has exactly one source of truth

The virtualiser positions rows by arithmetic (`index * rowHeight`); CSS paints them. If those
two ever disagree, rows overlap or gap — a bug that looks like a rendering glitch and is
miserable to trace. So `row-grid.ts` exports `resolveRowHeight(density, isNarrow)` (comfortable
56px, compact 36px, floored at 44px on touch widths for WCAG 2.5.5), and **both** the
virtualiser and each row's inline `height` call it. Neither infers a height from a Tailwind
padding class.

The breakpoint is resolved in JS via `NARROW_QUERY = '(max-width: 639px)'` — the exact width
`ROW_GRID`'s `sm:` variant branches on — so the CSS and the arithmetic can never disagree about
which regime the board is in.

### Undo restores the format too

The history snapshot is `{ activeFormat, boards }`, not just `boards`. Cross a player off in
Redraft, switch to Dynasty, hit undo: restoring the format as well means **the undo is always
visible**, instead of silently changing a board you are not looking at.

- Undoable: `toggleDrafted`, `clearDrafted`, `resetOrder`, `moveVisible`, `importState`.
- Not undoable: format switch, position, search, availability, theme, density. These are
  non-destructive view state; putting them in the stack would mean that undo-after-a-misclick
  toggles a filter back instead of restoring your board.
- Limit 50 entries. **Not persisted** — an undo stack surviving a refresh would let you undo
  edits from a session you can no longer see.
- Shortcuts are Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z (plus Ctrl/Cmd+Y). They **bail out on
  `<input>`/`<textarea>`/`<select>`/`contentEditable`**, so Cmd+Z while fixing a typo in the
  search box does native text undo rather than silently rolling back a board edit.

`domain/history.ts` is generic (`History<T>`) because `domain/` must not know what a `BoardSlice`
is — that type lives in `state/`, a higher layer, and ESLint enforces the boundary.

### Persistence went to schemaVersion 2 through a real migration

Theme and density are persisted, which changed the stored shape. `PROJECT.md` §5 says an
unknown version "throws today; a future change adds a migration rather than a fallback" — so
that is what happened: a named, forward-only `migrateV1ToV2` attaches `DEFAULT_PREFERENCES` to a
v1 blob. A board saved before this phase still loads. This is the first exercise of the
migration seam, and it now has a shape for v3 to copy.

### Export/import reuses the persistence validator rather than inventing a format

The exported file **is** the persisted blob: `serializeState` writes it, `parseStateJson`
validates it, `importState` reconciles it against the loaded dataset. Consequences that fall out
for free: a v1 backup imports correctly (the migration is reachable from the file picker, and is
tested), and an imported board is undoable like any other edit.

**Where fail-fast applies, precisely.** A user picking the wrong file is *invalid input*, not a
broken invariant, so `PersistedStateError` and a file-read failure are surfaced inline in a
`role="alert"`. Every other exception type propagates uncaught — the import is deliberately not
wrapped in a bare `catch` that would turn a real bug into a friendly message.

### The accessibility debt Phase 2 flagged is paid

Phase 2 shipped `aria-label` on each `<li>` conveying only name, rank, and the Alt+arrow hint —
which **overrode the row's entire content as its accessible name**, so a screen-reader user
never heard position, team, bye or tier. Now:

- The row label is a complete summary: `"Jahmyr Gibbs, rank 1, RB, DET, bye 6, tier 1."` (plus
  `drafted` when it applies). A test asserts that string exactly.
- The keyboard-move instructions moved to **one** visually-hidden paragraph referenced by every
  row via `aria-describedby`. 439 copies of the same sentence was the noise that made the label
  do double duty in the first place.
- A polite live region announces the two gestures that otherwise happen silently: crossing a
  player off ("Jahmyr Gibbs marked drafted.") and a move ("Bijan Robinson moved to rank 1."). Under
  Available-only, crossing a player off makes the row *vanish* — without an announcement there is
  no feedback at all.

Keeping an `aria-label` rather than deleting it is a deliberate departure from the naive fix:
letting the browser compute the name from subtree content would pull in both buttons' own labels
("Reorder X", "Mark X drafted") and read worse.

**Focus survives a move in a virtualised list.** A row moved by Alt+↑/↓ can land outside the
rendered window, unmounting the focused element and dumping focus on `<body>`. The board scrolls
the moved row back into view and restores focus to it. A test drives 30 consecutive Alt+ArrowDown
presses — rank 2 to rank 32, well past the initial window — asserting focus is on an `<li>` at
every step.

### Contrast was measured, not eyeballed

Every foreground/background token pair, in both themes:

| Pair | Light | Dark |
|---|---|---|
| text-primary / surface | 17.85:1 | 17.06:1 |
| text-primary / surface-muted | 17.06:1 | 13.98:1 |
| text-muted / surface | 4.76:1 | 6.96:1 |
| text-muted / surface-muted | 4.55:1 | 5.71:1 |
| accent-contrast / accent | 5.17:1 | 5.48:1 |
| danger / surface | 4.83:1 | 6.45:1 |
| danger / surface-muted | 4.62:1 | 5.29:1 |
| success / surface | 5.02:1 (was 3.30) | 10.25:1 |
| success / surface-muted | 4.79:1 | 8.40:1 |

`--color-success` was **already failing AA in light mode before dark mode existed** (green-600
at 3.30:1 on white, colouring the small "vs exp." delta text) — moved to green-700. `--color-danger`
and `--color-success` get distinct dark values rather than being reused; the light hexes measure
3.70:1 and 3.56:1 on `neutral-900` and would fail.

## Deviations to flag

**1. `src/features/preferences/` is a new feature directory.** Theme and density are app-wide
preferences belonging to no existing feature; putting them in `features/board/` would make the
board own settings that are not about the board. `PROJECT.md` §5 is updated to list it.

**2. `Board` owns its scroll container, not `App`.** The virtualiser needs a ref to the exact
element that scrolls, so `App`'s wrapper is `overflow-hidden` and supplies bounded height while
`Board` scrolls internally. `App.tsx` carries a layout-contract comment saying so — reverting
that `overflow-hidden` without moving scroll ownership back will silently break windowing.

**3. `ui/live-region.tsx` gained an optional `label` prop.** Three live regions now coexist (the
board's, the history/IO one, and dnd-kit's own assertive region), and they need distinct
accessible names to stay unambiguous — for screen-reader users first, and for tests second.

**4. `board-io.tsx` rebuilds `PersistedState` rather than importing the store's internal
`toPersistedState`.** A component must not reach into `state/`'s implementation. The duplication
is type-guarded: `serializeState` takes a `PersistedState`, so a future schema field that export
forgot is a compile error, not a silently truncated backup.

## Defects found and fixed during verification

**The export download was Chrome-only.** As first written, `handleExport` clicked an anchor that
was never appended to the document and revoked the object URL on the very next line. Both are
unreliable outside Chrome — Firefox has historically required a clicked anchor to be
document-connected, and revoking in the same synchronous turn can cancel a download that has not
yet started reading the blob (Firefox, Safari). For the *only* backup path of a user's
accumulated customization, a silently failing download is the worst available failure. The anchor
is now attached (hidden) for the click and removed after, and the revoke is deferred a turn —
still revoked, because a leaked blob URL pins the serialized board in memory for the tab's life.
Three assertions now pin this down, including that the anchor is connected *at the moment* click
fires and that the revoke has not happened synchronously.

## Verification

Re-run on the main thread after implementation:

| Command | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | clean — **0 errors, 0 warnings** |
| `npm run test` | `Test Files 20 passed (20)` / `Tests 226 passed (226)` |
| `npm run build` | 82 modules, 14.74 kB CSS / 373.96 kB JS (106.93 kB gzip) |
| `npx prettier --check .` | clean |
| `npm run dev` | Vite ready in 183 ms; `curl http://[::1]:5173/` → HTTP 200 |

Dark mode and reduced motion were confirmed present in the **built** CSS (`[data-theme=dark]`,
`color-scheme:light`/`dark`, `prefers-reduced-motion`), not merely in source — Tailwind v4 can
drop rules it considers unused, so this is worth checking rather than assuming.

Test count went 140 → 226:

| Where | Tests | Added this phase |
|---|---|---|
| `domain/` | 85 | `history` (14), `tiers` (10) |
| `state/` | 50 | schema-v2 migration, export/import parsing, undo/redo, preferences |
| `features/board/` | 35 | `virtual-window` (8), board actions (9), board IO (5) |
| `ui/` | 11 | `live-region` (2), `use-media-query` (3) |
| `app/` + `data/sources/` + `tests/` | 45 | theme applies `data-theme`; undo-via-keyboard integration |

The weighting still holds: `virtual-window.ts` and `history.ts` are where a silent corruption
would come from, and both are pure functions tested without a DOM in ~10ms.

## Known limitations, and where they get addressed

- **Pointer-drag under virtualisation is unverified by tests, by design.** jsdom does no layout,
  so `getBoundingClientRect()` returns zeros and a geometric pointer drag cannot be exercised
  (`PROJECT.md` §4). Specifically unverified: that `restrictToFirstScrollableAncestor` constrains
  a drag correctly, that dnd-kit's auto-scroll mounts new rows as it crosses the window edge, and
  that a pointer drop resolves against absolutely-positioned windowed rows. The keyboard paths —
  Alt+↑/↓ and dnd-kit's `KeyboardSensor`, which resolves by array order rather than geometry —
  **are** exercised. The remaining check is a hand pass in Chrome's Performance panel, which is
  exactly what MVP 3.7 asks for.
- **3.7's "no dropped frames" is still a measurement you owe yourself.** Virtualisation is
  implemented and the row count is provably bounded; the frame timing has not been measured.
- **`--color-border` is 1.23:1 in light mode**, below the 3:1 non-text threshold. Flagged, not
  fixed: it is used for decorative dividers and card outlines only, never as the sole cue for an
  interactive boundary (buttons and inputs carry a fill, label, or focus ring). Fixing it means
  re-tuning the shared neutral ramp that dividers and row separators across three features depend
  on — a deliberate call, revisit if a border ever becomes load-bearing.
- **Several file comments reference `phase2-contract.md`**, which does not exist in `docs/`. Stale
  pointer inherited from Phase 2; harmless, worth a sweep next time those files are touched.
- **Export/import supersedes nothing yet.** MVP 4.13 replaces it with a raw `.sqlite` export *if*
  Phase 4 happens.

## Deliberately left out

- Everything in Phase 4 (SQLite, notes, watchlist, multiple boards, custom tiers, scarcity and
  bye views, dataset-refresh reporting) — unchanged, and still gated on real draft usage.
- Any change to `src/data/rankings/*.json` or the generator — untouched this phase, per
  `PROJECT.md` §8.
