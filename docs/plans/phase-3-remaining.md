# Phase 3 — what's left

Companion to [`../summary-reports/phase-3-draft-day-polish.md`](../summary-reports/phase-3-draft-day-polish.md),
which records what shipped. This file records what did **not**, and what "done" would take.

**Status: all eight Phase 3 items are implemented and committed** (`ea81c9e`). 226 tests pass;
`typecheck`, `lint`, `build` and `prettier` are clean. Nothing below is a missing feature.

What's left splits into three kinds, and they are not equally urgent:

1. **Verification that only a real browser can do** — the honest gap. Some of it is the MVP's own
   done-when criterion.
2. **Debt deliberately deferred**, with the reasoning recorded so it isn't re-litigated from scratch.
3. **Open questions** that surfaced during the build and want a decision, not code.

---

## 1. Verification a real browser has to do

`jsdom` implements the DOM tree but does **no layout**, so `getBoundingClientRect()` returns zeros.
Everything in this section depends on layout or on frame timing, which is why it is not in the test
suite. Per `PROJECT.md` §4 this is a deliberate trade, not an oversight — the project dropped
browser automation on the grounds that a single-user board's breakages are obvious in about one
second. That argument only holds if someone actually looks.

### 1.1 The 3.7 measurement — the one real outstanding deliverable

MVP 3.7 is worded as *"verify no dropped frames while dragging a 400-row board — measured by hand
in Chrome's Performance panel"*. Virtualisation is implemented and the mounted-row count is
provably bounded (a test asserts it, and suite runtime fell 8.75s → ~3.3s), but **frame timing has
never been measured**. The item is not finished until it has been.

Concretely:

- [ ] `npm run build && npm run preview` (measure the production build — a dev build's timings are
      not the ones users get).
- [ ] Load Dynasty Superflex, the 439-player format, position filter on **All**, density
      **comfortable** (the tallest rows, so the most mounted at once).
- [ ] Chrome DevTools → Performance → record → drag a row from near the top to near the bottom,
      slowly enough to cross the window boundary several times → stop.
- [ ] Read the frame track. Looking for: no long tasks over ~50ms during the drag, and no red
      "dropped frames" bars. If there are, the flame chart names the culprit — likely candidates are
      `visiblePlayers` recomputation or a `useSortable` remount storm at the window edge.
- [ ] Repeat once in **compact** density (36px rows ⇒ ~55% more rows mounted for the same viewport).
- [ ] Record the result — pass or fail, with numbers — in the Phase 3 summary report. A measurement
      nobody wrote down has to be taken again.

### 1.2 Pointer-drag under virtualisation

The interaction between dnd-kit's geometric pointer dragging and windowed, absolutely-positioned
rows is the part of Phase 3 with the **least test coverage and the most ways to be subtly wrong**.
Keyboard reordering is fully covered (dnd-kit's `KeyboardSensor` resolves by array order, not
geometry, and a test drives 30 consecutive moves past the initial window). These do not have that:

- [ ] `restrictToFirstScrollableAncestor` actually constrains the drag to the scrollable list
      (it replaced `restrictToParentElement`, which under virtualisation would pin a drag to the
      sliver of mounted rows).
- [ ] dnd-kit's auto-scroll mounts new rows as the drag crosses the window edge — i.e. you can drag
      a player from rank 300 to rank 5 in one gesture, not just within the visible window.
- [ ] The drop resolves to the row you're actually hovering, against absolutely-positioned rows.
- [ ] The dragged row renders above its neighbours while lifted (`zIndex`) and lands where dropped.

If any of these fail, the fix is in `board.tsx`'s `DndContext` configuration; the pure reorder logic
underneath (`moveInFilteredView`, `resolveDragMove`) is separately tested and is not the suspect.

### 1.3 The MVP's own done-when criterion

Phase 3's stated bar is *"a full mock draft can be run end to end without friction, and a
keyboard-only user can do everything a mouse user can."* Neither half has been exercised.

- [ ] **Run a mock draft end to end.** Cross off ~150 players at realistic speed, reorder a few
      mid-draft, switch position filters constantly, undo a deliberate misclick. This is the only
      test that can find "friction", which is not a thing a unit test can assert.
- [ ] **Keyboard-only pass.** Unplug the mouse. Reach and operate: format switch, theme, density,
      position tabs, search, availability, undo/redo, reset, clear, export, import, row reorder
      (both Alt+↑/↓ and the drag handle's Space-lift), and cross-off. Everything is *implemented*
      as keyboard-reachable; nobody has walked it.
- [ ] **Screen-reader spot check** (VoiceOver on macOS, ⌘F5). The 3.6 rework is the single largest
      behavioural change of the phase and is verified only by assertions about attribute strings —
      that they *read well* is a different claim. Listen to: a row's announcement, a cross-off under
      Available-only (the row vanishes; the live region is the only feedback), and an undo.

### 1.4 Visual checks

- [ ] Dark mode in a real browser, both `dark` and `system`, including a live OS theme flip while
      the app is open (the media-query listener is meant to repaint without a reload).
- [ ] 375px-wide viewport: no horizontal scrolling, toolbar stacks, cross-off is thumb-reachable,
      and the five-column narrow layout is actually usable rather than merely non-overflowing.
- [ ] Tier bands read as breaks at a glance in both themes — the point of 3.3 is peripheral-vision
      legibility, which is a judgement call, not an assertion.
- [ ] `prefers-reduced-motion` on: reorder and cross-off stop animating.

---

## 2. Debt deliberately deferred

Recorded so it isn't rediscovered as if it were new.

### 2.1 `--color-border` is 1.23:1 in light mode

Below the 3:1 WCAG threshold for non-text contrast. **Flagged, not fixed**, because it is used only
for decorative dividers and card outlines — never as the sole cue for an interactive boundary
(buttons and inputs carry a fill, a label, or a focus ring). Raising it means re-tuning the shared
neutral ramp that dividers and row separators across three features depend on.

**Revisit if** a border ever becomes the only indicator of an interactive element — at which point
it stops being decorative and the exemption no longer applies.

### 2.2 Three files reference a `docs/phase2-contract.md` that does not exist

`src/app/App.tsx:4`, `src/features/board/board.tsx:3`, `src/features/board/board.test.tsx:8`. A
stale pointer inherited from Phase 2 — the content those comments describe now lives in
`PROJECT.md` §5 and the Phase 2 summary report. Harmless, but it sends a reader looking for a file
that was never committed.

- [ ] Repoint the three comments next time those files are touched. Not worth a commit of its own.

### 2.3 Undo does not cover an import's non-board fields

`importState` applies `activeFormat`, `boards`, `filters` **and** `preferences`; undoing it restores
only `{activeFormat, boards}`. So undoing an import leaves the imported theme and filters in place.
This is the deliberate scope of the snapshot — undo is a board time machine, not a whole-app one,
and widening it would mean an undo after a misclick could also revert your theme.

**Revisit only if** importing turns out to be common enough that the surprise is worth the wider
snapshot. Cheap to change: widen the snapshot type in `board-store.ts`.

---

## 3. Open questions worth a decision

### 3.1 439 tab stops

Every row is `tabIndex={0}`, so tabbing from the top of the board to the bottom is 439 stops. That
is correct for reaching any row by keyboard, and miserable for reaching anything *after* the board.
Virtualisation makes it stranger: unmounted rows aren't in the tab order at all, so tabbing pulls
new rows in as focus scrolls the list.

Worth checking in a browser (does tabbing off the last mounted row behave sanily?), then deciding
between: leave it, use roving `tabindex` so the list is a single tab stop with arrow-key navigation
inside it (the pattern `ui/toggle-group.tsx` already uses), or add a skip link past the board.

Roving `tabindex` is the conventional answer for a long list, but it would change how Alt+↑/↓ and
the drag handle interact with focus — not a small change, and it should follow §1.3's keyboard pass
rather than precede it.

### 3.2 Is `overscan: 6` right?

Chosen without measurement. §1.1's recording is the opportunity to check whether the window edge is
where any dropped frames come from, and to tune it with evidence rather than taste.

---

## Definition of "Phase 3 is truly finished"

- §1.1 measured and the result written into the summary report.
- §1.2 exercised by hand, with any failure fixed.
- §1.3's mock draft and keyboard pass run once, with whatever friction they surface either fixed or
  recorded here.

§2 and §3 are explicitly **not** blockers — they are recorded decisions and open questions, and
`PROJECT.md` §5's dependency map already puts the next real step at *using the board in a live
draft*, not at building Phase 4.

## Not in scope

Everything in Phase 4 (SQLite, notes, watchlist, multiple boards, custom tiers, positional scarcity,
bye-week collisions, dataset-refresh reporting) and Phase 5. Phase 4 remains gated on real draft
usage — per the MVP overview, if notes and multiple boards never get used in anger, `localStorage`
stays correct and Phase 4 should be **dropped rather than built for its own sake**.
