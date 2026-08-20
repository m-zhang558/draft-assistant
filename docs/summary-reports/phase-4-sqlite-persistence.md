# Phase 4 — SQLite persistence and the features it unlocks

Status: **done**, verified on the main thread rather than taken from agent self-reports. All
thirteen items (4.1–4.13) shipped. 405 tests pass; `typecheck`, `lint`, `build` and
`prettier --check .` are clean.

> **The gate was not met, and that is recorded rather than hidden.** The MVP overview gates
> Phase 4 on real draft usage, and its open question 6 says to drop the phase rather than build it
> for its own sake if notes and multiple boards never get used in anger. No live draft has been
> run. Phase 4 was built on explicit instruction; whether it earned its place is still an open
> question, and [`../plans/phase-4-remaining.md`](../plans/phase-4-remaining.md) keeps it open.

Phase 3 completed the MVP on `localStorage`. Phase 4 replaces the storage engine and then builds
the seven features that were impractical over a single serialized JSON blob. Those are two very
different jobs, and this report is organised that way, because the risk is concentrated almost
entirely in the first.

## What shipped

| # | Item | Where it lives |
|---|---|---|
| 4.1 | Engine + VFS | `state/db/worker.ts` — `@sqlite.org/sqlite-wasm` on the `opfs-sahpool` VFS, in a Web Worker |
| 4.2 | Schema + migrations | `state/db/schema.ts` — forward-only migrations as data, each in its own transaction |
| 4.3 | Async state boundary | `state/board-store.ts` `createBoardStore` / `initialiseBoardStore` split; `app/App.tsx` boot gate |
| 4.4 | Migration from `localStorage` | `state/migrate-local-storage.ts` — one-time, non-destructive |
| 4.5 | Fractional `sort_order` | `domain/fractional-order.ts` (pure) + `moveVisible`'s single-`UPDATE` path |
| 4.6 | Multiple boards | `features/boards/board-switch.tsx` + `board-manager.tsx`, `board` table |
| 4.7 | Notes | `features/board/player-note.tsx`, `board_player.note` |
| 4.8 | Watchlist / targets | Row star + `features/filters/watched-toggle.tsx`, `board_player.watched` |
| 4.9 | Custom tiers | `domain/tiers.ts` `resolveTierStarts`, `board_player.tier_break` |
| 4.10 | Positional scarcity | `domain/scarcity.ts` + `features/insights/scarcity-panel.tsx` |
| 4.11 | Bye-week view | `domain/bye-weeks.ts` + `features/insights/bye-week-panel.tsx` |
| 4.12 | Dataset refresh | `domain/dataset-refresh.ts` + `features/board/dataset-refresh-banner.tsx` |
| 4.13 | Export / import | `features/board/board-io.tsx` — raw `.sqlite`, with the legacy `.json` path kept |

## The decisions that carry the phase

### 1. The SQL was separated from the thing that hosts it, so it could be tested

This is the load-bearing decision, and it was made before a single query was written.

`jsdom` has no OPFS, no real `Worker`, no `SharedArrayBuffer`. The obvious layering — the worker
owns SQLite *and* owns the queries — makes 100% of the persistence layer unverifiable. That is not
an acceptable posture for the layer holding the user's accumulated draft board.

So an interface sits between them:

```
db/sql-executor.ts   interface SqlExecutor { all / run / transaction }   ← the seam
db/schema.ts         migrations as data                                  ← tested
db/repository.ts     every query in the app                              ← tested
db/commands.ts       the command union + exhaustive dispatch             ← tested
db/protocol.ts       message types + a pure handleRequest                ← tested
db/client.ts         postMessage, id correlation, error propagation      ← tested
db/worker.ts         sqlite3 + opfs-sahpool bootstrap and a switch       ← NOT testable
```

`worker.ts` is **149 lines and contains zero SQL text** — verified by grep, not by assertion. It
is the entire unverifiable surface of the phase.

And the tests use a **real SQL engine, not a mock**: `node:sqlite`'s `DatabaseSync`, built into
Node 22.19. Same engine, same dialect, no OPFS. Migrations, `ON DELETE CASCADE`, constraint
violations, transaction rollback and the fractional-key updates are all exercised for real in
`npm run test`. A mock executor would have faked exactly the parts most likely to be wrong.

`node:sqlite` is flagged experimental in Node 22, and is used **only in tests** — the shipped
engine is `@sqlite.org/sqlite-wasm`. If it is ever removed, the same repository tests run against
`sqlite-wasm`'s own Node build, which the package already exports.

### 2. The VFS choice was proven before it was relied on

`PROJECT.md` §4 promises "any static host (Vercel / Netlify / GH Pages)". GitHub Pages cannot set
response headers, so the standard `opfs` VFS — which needs COOP/COEP for `SharedArrayBuffer` —
would have silently removed a hosting target we promised. `opfs-sahpool` needs no headers.

That premise was tested first, as a stop/go gate, before any query was written. It passed:

| Asset | Size |
|---|---|
| `index-*.js` (entry chunk) | 404.59 kB (gzip 115.40 kB) |
| `worker-*.js` | 224.21 kB |
| `sqlite3-worker1-*.js` | 213.43 kB |
| `sqlite3-opfs-async-proxy-*.js` | 32.29 kB |
| `sqlite3-*.wasm` | 864.75 kB (gzip 401.93 kB) |

The only build config needed was `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }`, which
affects the dev server only. **The 864 kB wasm is not in the entry chunk** — `grep` finds zero
occurrences of `sqlite3InitModule` or `installOpfsSAHPoolVfs` in the built entry bundle. It is
fetched by the worker, off the first-paint path, which is what the MVP overview's bundle-cost risk
demanded.

The entry chunk grew 373.96 kB → 404.59 kB. That +30.6 kB is Phase 4's own React (board manager,
note editor, insights panels, row overflow, banners) — not the database.

> The MVP overview's "current bundle of 301 KB" figure was already stale before this phase; the
> measured pre-Phase-4 baseline was 374 kB.

### 3. `sort_order` is `REAL`, and the arithmetic is a pure function

Dragging a player from rank 400 to rank 2 with dense integer ranks means ~398 `UPDATE`s on the
gesture that has to stay at 60fps. With fractional keys it is **one** `UPDATE`: the midpoint of the
two new neighbours.

The limit is real — repeatedly bisecting one gap halves it every time, and doubles run out. So
`domain/fractional-order.ts` splits the job in two on purpose: `keyBetween` is deliberately dumb
(midpoint, throws on nonsense), and `needsRenormalisation` is the guard callers run *first*.
`MIN_ORDER_GAP` is set at `ORDER_STEP / 2^20` — about 20 splits — against a measured collision
point of ~54 splits. That ~30-split margin is deliberate: the guard must fire while there is
precision left, not at the edge of it.

The adversarial test proves the pair cannot fail silently: 60 consecutive insertions into the same
gap, asserting the guard fires before `keyBetween` could ever return a key equal to a neighbour.
Getting this wrong would corrupt the board's *order* — the one thing this app exists to preserve —
and would do it without an error.

A separate store test asserts the payoff directly: one `moveVisible` issues exactly one
`moveSortKey`, and every other row's `sort_order` in the database is byte-identical afterwards.

### 4. Boot gates once; nothing else ever awaits

`PROJECT.md` §4's rule is "the UI must never await a query to paint a row". Three rules implement
it:

1. **One await, at boot.** `createBoardStore()` builds an inert `status: 'loading'` store
   synchronously — no client, no I/O, safe in `jsdom`. `initialiseBoardStore()` does the async
   work. `App` renders a loading shell, then the board. Gating the *first* paint is what stops a
   user editing a board that is about to be overwritten by hydration.
2. **Reads never touch the database after boot.** `load()` returns every board and every setting
   in one message; the UI reads the Zustand store synchronously, exactly as in Phase 3.
3. **Writes are fire-and-forget with a visible failure.** A mutation updates memory synchronously,
   then posts its command. A rejected command sets `persistenceError` and `App` renders a
   `role="alert"` banner above the board.

Memory is deliberately **not** rolled back on a failed write. Silently reverting the user's edit
under them is worse than a visible "this did not save" banner — they can see what they did and act
on it.

And OPFS being unavailable is a **hard failure**, never a fallback. Private browsing surfaces as
`status: 'error'` with the engine's own message and a panel that names private browsing as the
likely cause. Falling back to `localStorage` would mean a board that quietly stops persisting,
which is the worst outcome on the table.

### 5. The `localStorage` key is never cleared automatically

4.4 is one-time and non-destructive. The legacy blob is parsed by the **existing**
`loadPersistedState`, so its v1→v2 migration is inherited free — there is no second parser to
drift. Then two boards are seeded, and **the key is left exactly where it was**. Verified: no
`removeItem` and no `clearPersistedState` call exists anywhere on the boot path.

That matters because OPFS is not user-inspectable. Until a real `.sqlite` export existed, the
`localStorage` key was the *only* rollback path. Now that 4.13 ships one, `board-io.tsx` offers a
one-click "clear old backup" behind a confirm — the user's decision, not the app's.

One deliberate exception to fail-fast, documented where it happens: a *corrupt* legacy key is
downgraded to a `persistenceError` banner rather than blocking boot. It is a legacy artefact, not
the live store, and refusing to start over a backup nobody is reading would be the wrong trade.

### 6. Custom tiers are all-or-nothing

A board with ≥1 custom break ignores the source's tiers entirely (`resolveTierStarts`). This is
not laziness: a half-custom scheme cannot be read at a glance, and peripheral-vision legibility is
the entire point of tier bands (Phase 3.3). The UI says so when custom breaks are active and
offers a reset, which is **one** history entry via `clearTierBreaks` — not N.

## Deviations from the plan, and defects caught

- **`board.id` is `TEXT`, not `INTEGER PRIMARY KEY`** (the MVP sketch said integer). A board id has
  to survive an export/import into a database that may already hold that rowid. The id is never
  displayed, so an opaque string costs nothing and removes the whole collision class.
- **`board_player.tier_break`** was added for 4.9. Same grain the table already has; a separate
  tier table would have added a join for a boolean.
- **Seed-timestamp coin flip (caught by the suite).** Both seeded boards originally shared one
  `createdAt`, so which board booted active depended on how two random UUIDs happened to
  string-compare — an intermittently failing test. Fixed by deriving the second board's timestamp
  deterministically. "Redraft PPR boots active" is now a guarantee.
- **Import temp-directory bug (caught while making 4.13 testable).** Deleting the imported
  database's temp directory immediately broke every subsequent write: SQLite's rollback journal
  needs to create sibling files there. Fixed by deferring cleanup. This one was only findable
  *because* the test-support client runs a real engine.
- **Notes and tier-breaks were briefly unreachable at 375px.** Stage D folded them into the same
  `NARROW_HIDDEN` class used for inert text columns, which meant the features did not exist on a
  phone rather than merely looking different — a real regression against `PROJECT.md` §3.5/§6.
  Fixed with a single `⋯` row-overflow popover on narrow widths, swapped by a JS conditional
  rather than a CSS-hidden duplicate (two mounted controls sharing an accessible name are
  ambiguous to a test query and to assistive tech before the stylesheet applies). Cross-off is
  untouched at every width — it stays the fastest gesture on the row, which is the app's core loop.
- **A raw NUL byte in `board-io.tsx`.** `SQLITE_MAGIC` was written with a literal NUL instead of
  the `\0` escape, which made the source a binary file (`file` reported `data`; `grep` refused to
  search it). Functionally correct, invisible to `tsc`, `eslint`, `vitest` and `prettier` alike —
  found by noticing that a `grep` which should have matched returned nothing. Replaced with the
  escape.

## What the untestable surface actually is

Honesty about coverage, since the phase's whole testability argument rests on this being small:

- **`state/db/worker.ts`** (149 lines): the `sqlite3InitModule` bootstrap, `installOpfsSAHPoolVfs`,
  and a `switch` that delegates to the tested `handleRequest`. Zero SQL.
- **The `opfs-sahpool` VFS itself** — that OPFS persists across reloads, that private browsing
  fails the way the error panel claims, and that the browser's storage quota behaves. None of this
  can be asserted in `jsdom`.

Both are in [`../plans/phase-4-remaining.md`](../plans/phase-4-remaining.md) §1 as hand checks, and
neither has been performed.

## Verification

Run on the main thread after all stages landed:

- `npm run test` — **405 passed (35 files)**, up from 226 at the end of Phase 3.
- `npm run typecheck` — clean.
- `npm run lint` — zero errors, zero warnings.
- `npm run build` — clean; asset split confirmed by inspecting `dist/` (table above) and by
  grepping the entry chunk for sqlite symbols (zero).
- `npx prettier --check .` — clean.

## What Phase 5 (or a Phase 4 revisit) needs to know

- **`state/db/`'s seam is `SqlExecutor`, not the worker.** Anything new that needs SQL goes in
  `repository.ts` against that interface and is tested with `node:sqlite`. Adding a query to
  `worker.ts` would put it outside the test suite — that is the one rule this layer has.
- **Schema changes go through `MIGRATIONS` as a new forward-only version**, never an edit to v1.
  `schema_version` is checked at open time and a database written by a *newer* app throws rather
  than being downgraded.
- **`localStorage` persistence (`state/persistence.ts`) is still live code**, not dead: it is the
  4.4 migration source and the legacy `.json` import path. Its `schemaVersion` stays frozen at 2.
- **Rankings are still bundled and read-only** (MVP open question 5), joined in JS. 4.10 and 4.11
  were written as pure `domain/` aggregations and did not turn out awkward, so the recommendation
  to leave `RankingSource` alone held up.
- **Rookie draft picks (MVP open question 4) remain dropped.** `Position` still has no slot for
  them and 4.6–4.13 gave no new reason to add one.
