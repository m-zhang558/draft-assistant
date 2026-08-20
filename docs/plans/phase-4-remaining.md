# Phase 4 — what's left

Companion to [`../summary-reports/phase-4-sqlite-persistence.md`](../summary-reports/phase-4-sqlite-persistence.md),
which records what shipped. This file records what did **not**, in the same three kinds
[`phase-3-remaining.md`](./phase-3-remaining.md) uses.

**Status: all thirteen Phase 4 items are implemented.** 405 tests pass; `typecheck`, `lint`,
`build` and `prettier --check .` are clean. Nothing below is a missing feature.

---

## 1. Verification only a real browser can do

The phase was built so the untestable surface is small (`state/db/worker.ts`, 149 lines, zero
SQL). Small is not zero, and **none of the following has been performed.**

### 1.1 OPFS actually persists — the one that matters

Every test in the suite runs against `node:sqlite` in a temp file. **Nothing has ever verified that
`opfs-sahpool` writes survive a browser reload**, which is the entire premise of the phase.

- [ ] `npm run build && npm run preview`. Cross off ~20 players, reorder a few, add a note, star
      two players, draw a custom tier break.
- [ ] Hard-reload. Everything must come back — including the note and the tier break, not just the
      order and the drafted set.
- [ ] Close the tab, reopen it, confirm again. (OPFS is origin-scoped, not tab-scoped; a bug here
      would look fine on a soft reload.)
- [ ] Confirm in DevTools → Application → Storage that an OPFS entry exists and `localStorage`
      still holds the untouched legacy key.

### 1.2 The failure modes, which are the whole reason boot is fail-fast

- [ ] **Private browsing.** Open the app in a private/incognito window. Expected: the error panel,
      naming private browsing, with the board absent — *not* a silently non-persisting board. If
      OPFS turns out to work fine in private windows on this browser, the panel's copy is
      misleading and should be reworded.
- [ ] **Write failure after boot.** Harder to provoke; if a way is found (quota exhaustion is the
      realistic one), confirm the `persistenceError` banner appears and that in-memory edits are
      still on screen rather than reverted.
- [ ] **A database written by a newer schema.** Export a `.sqlite`, hand-edit `schema_version` to
      2, import it. Expected: a loud failure, never a downgrade.

### 1.3 The migration, once, on a real pre-Phase-4 board

The unit tests cover `buildSeedCommands`. Nobody has run the actual upgrade path in a browser.

- [ ] Check out the Phase 3 build, use it enough to accumulate a real board, then load the Phase 4
      build over the same origin. Order and drafted set must survive, and the `localStorage` key
      must still be there afterwards.
- [ ] Then exercise "clear old backup" and confirm the board keeps working.

### 1.4 4.13 round trip in a real browser

- [ ] Export a `.sqlite`, open it in a desktop SQLite client, confirm it is a readable database
      with the expected rows. (This is the recovery path the MVP overview calls the *only* one,
      since OPFS is not user-inspectable — it needs to actually be inspectable.)
- [ ] Import it back into a different browser profile and confirm every board arrives.
- [ ] Import a Phase 3.8 `.json` backup and confirm the legacy path still works.

### 1.5 Drag performance, now that a database write is on the gesture

Phase 3.7's frame-timing measurement was already outstanding
([`phase-3-remaining.md`](./phase-3-remaining.md) §1.1) and is now **more** worth doing, not less:
`moveVisible` posts a `moveSortKey` command on every drop, and a `renormaliseOrder` occasionally.

- [ ] Re-run §1.1's Performance-panel recording against the Phase 4 build, and confirm the
      `postMessage` on drop does not show up as a long task.
- [ ] Provoke a `renormaliseOrder` by hand (repeatedly drop a player into the same gap) and check
      the frame cost of the whole-board rewrite. It is designed to be rare and off the interaction
      path; that it *is* off the path has not been measured.

## 2. Debt deliberately deferred

### 2.1 Everything in `phase-3-remaining.md` §1 is still outstanding

The mock draft, the keyboard-only pass, the screen-reader spot check, the visual checks. Phase 4
made all of them larger — there are now notes, stars, tier-break controls, a board manager, two
insights panels and a row-overflow menu that none of those passes have ever covered.

### 2.2 `--color-border` is still 1.23:1 in light mode

Unchanged from `phase-3-remaining.md` §2.1, and the exemption still holds for the same reason
(decorative dividers only, never the sole cue for an interactive boundary). Worth re-checking that
the new panels and popovers did not quietly make a border load-bearing.

### 2.3 The stale `docs/phase2-contract.md` pointers are still there

`phase-3-remaining.md` §2.2 flagged three comments pointing at a file that was never committed.
`App.tsx` and `board.tsx` were both heavily edited this phase and the pointers were carried along
rather than repointed. Cheap; still not done.

### 2.4 Board CRUD is not undoable

Deliberate: creating or deleting a board is not a board *edit*, and an undo after a misclicked
cross-off should not be able to resurrect a board you deliberately deleted. Delete is gated behind
`ConfirmButton` instead. **Revisit only if** a real user actually loses a board to a misclick.

### 2.5 A `.sqlite` import wipes the undo history

Also deliberate — an undo snapshot taken before the import references board ids the new database
may not have, so replaying it would restore a board that does not exist. Matching a fresh boot is
the honest behaviour. The legacy `.json` import is still undoable, because it applies onto the
existing boards rather than replacing them.

## 3. Open questions worth a decision

### 3.1 Did Phase 4 earn its place?

The MVP overview gates this phase on real draft usage and says to drop it if notes and multiple
boards never get used in anger. **That gate was never met** — Phase 4 was built on instruction,
before a single live draft. The question it was meant to answer is therefore still open, and is now
harder to answer honestly, because the code exists and sunk cost will argue for it.

The fair test is unchanged: run a real draft. If notes, watchlist and multiple boards go unused,
that is evidence about the features, not about the storage engine — and the storage engine is the
part that is expensive to keep (a wasm binary, an async boundary, a whole untestable worker).

### 3.2 `node:sqlite` is experimental

The entire test strategy depends on a Node builtin flagged experimental in Node 22. It is never
shipped, and `@sqlite.org/sqlite-wasm` exports a Node build that could replace it. Worth doing
proactively if a Node upgrade ever warns about removal — not before.

### 3.3 439 tab stops, still

`phase-3-remaining.md` §3.1's open question, now with more controls per row (star, note,
tier-break or overflow). The roving-`tabindex` option got more attractive and more expensive at the
same time. Still gated behind §1.3's keyboard pass, which has not happened.

### 3.4 Is `overscan: 6` right?

Unchanged and still unmeasured (`phase-3-remaining.md` §3.2).

---

## Definition of "Phase 4 is truly finished"

- §1.1 verified — OPFS persistence across a reload, in a real browser. Until this is done, the
  phase's central claim is untested.
- §1.2's private-browsing path checked, and the error panel's copy corrected if it is wrong.
- §1.3's migration run once against a genuine pre-Phase-4 board.
- §1.4's export opened in a real SQLite client.

§2 and §3 are not blockers. §3.1 is the one that should be answered before Phase 5 is considered
at all.
