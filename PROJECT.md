# PROJECT.md — Fantasy Assist

Project-specific facts for Claude Code. Global conduct rules live in `~/.claude/CLAUDE.md`;
this file wins for anything project-specific.

---

## 1. Overview

**Fantasy Assist** is a single-user, browser-based fantasy football **draft board**. It is
the thing you keep open on a second monitor while a draft is running: a ranked list of
players you have personally tuned, filtered to the position you care about, with drafted
players crossed off in one click.

It is deliberately *not* a league platform. It does not sync rosters, run mock drafts, or
manage a season. It does one job — telling you who to take next — and does it fast enough
to use under a 60-second pick clock.

### Objective

Turn a generic expert ranking list into **your** ranking list, and keep it usable live.

Three concrete goals:

1. **Customize** — reorder players up and down so the board reflects your own valuations,
   and have that survive a page refresh.
2. **Cross off** — mark a player as drafted (by you or by anyone) in one click, so the top
   of the list is always the best player actually available.
3. **Filter** — narrow to QB / RB / WR / TE / etc. instantly, because mid-draft you are
   asking "who's the best RB left?", not "show me everyone".

### Success criteria for the MVP

- Board loads with real 2026 rankings for two formats: **Redraft PPR** and **Dynasty Superflex**.
- Reordering and crossing off take one gesture each and persist across refresh.
- Position filter and search respond with no perceptible lag on a ~400-player list.
- Zero setup: open the URL, start drafting. No login, no server.

### Non-goals (explicitly out of scope)

- User accounts, multi-user sync, or a backend database.
- Live league integration (Sleeper / ESPN / Yahoo APIs).
- Projections, trade calculators, start/sit advice, or in-season tooling.
- Scraping or redistributing paywalled ranking data (see §3).

---

## 2. Users and core flows

Single persona: **you, mid-draft.** Everything is optimized for that moment.

| Flow | Trigger | Expectation |
|---|---|---|
| Pre-draft tuning | Days before | Drag players into your preferred order; the tier/rank recomputes |
| Pick made by someone else | Every ~60s | One click to cross off; player greys out and drops out of "available" |
| Your turn | Every ~10 picks | Glance at top of filtered list, take the name, cross it off |
| Wrong click | Rare, urgent | Undo restores state immediately |
| Board switch | Between drafts | Pick a saved board; each keeps its own order, drafted set, notes, watchlist and tiers |
| Note to self | Pre-draft / mid-draft | "hamstring, monitor Thursday" on a row, without leaving the board |
| Watchlist | Pre-draft | Star your targets, then filter to just them |
| "Who's thin?" | Mid-draft | Scarcity panel: how many are left at each position, and in the top tier |

---

## 3. Data source — read this before touching ingestion

Rankings come from **Flock Fantasy**, per the project brief.

**Verified (2026-08-18, Phase 1):** Flock serves its consensus rankings from a **public,
unauthenticated** endpoint. No login, no subscription, no scraping:

```
GET https://api.flockfantasy.com/rankings?format=<FORMAT>&pickType=general
```

| Our format | `<FORMAT>` | Players |
|---|---|---|
| `redraft-ppr` | `REDRAFT` | 426 |
| `dynasty-sf` | `SUPERFLEX` | 439 (456 rows less 17 rookie draft picks) |

A logged-out caller gets `subscribed: false` and still receives the full list. Only the
personalised routes (`/rankings/platform`, `/rankings/configurations`) require auth — we do
not touch those.

> An earlier check concluded these rankings were paywalled. That was wrong, and the error is
> instructive: `www.flockfantasy.com` is a Next.js **marketing** page whose sitemap lists one
> URL and whose `/rankings` 404s, while the apex `flockfantasy.com` is the actual app calling
> the API above. Probing only the `www` host is what produced the false negative.

**Rules:**

- Rankings live in `src/data/rankings/*.json`, versioned in git, one file per format.
- Every dataset file carries a `provenance` block: `source`, `sourceUrl`, `format`, `season`,
  `retrievedAt`, `upstreamFormat`, `upstreamLastUpdated`, `playerCount`, `notes`.
- Datasets are **generated, then committed** — `npm run fetch:rankings`
  (`scripts/fetch-rankings.mjs`). Refreshing rankings means re-running that script and
  committing the diff. The generator is deterministic: same upstream data in, byte-identical
  file out.
- **The app makes no network calls at runtime.** Ingestion is an adapter behind the
  `RankingSource` interface; the default adapter statically imports the local JSON. A licensed
  API or a personal export plugs in there — nothing else in the app changes.
- Do **not** add code that authenticates to, or proxies, a paywalled provider endpoint.

### Normalization decisions (applied in the generator, not at runtime)

The upstream shape does not match our domain model. These mappings are deliberate:

- **`baseRank` is derived, never copied.** Upstream `averageRank` is `null` for all 70 K/DEF
  rows in redraft and contains ties (20 redraft, 44 SF). Players are sorted by
  `(averageRank ?? +Infinity, position order, name, id)` and assigned a dense `1..N`. The `id`
  tiebreak is what makes regeneration byte-stable.
- **Rookie draft picks are excluded.** 17 `SUPERFLEX` rows are picks (`"2027 EARLY 1st"`) with
  `position: null`. `Position` has no slot for them; representing tradeable picks is a Phase 4
  question, not a data-layer one.
- **`DEF` → `DST`** to match `Position`.
- **`team: null` → `"FA"`** (free agents).
- Optional fields (`tier`, `byeWeek`, `age`) are **omitted** when upstream is null — never
  emitted as `null` and never given a placeholder value.

**Position coverage differs by format** — upstream does not rank kickers or defences for
superflex. Phase 2.7's position tabs must handle a legitimately empty position rather than
treat it as a load failure:

| Format | QB | RB | WR | TE | K | DST |
|---|---|---|---|---|---|---|
| `redraft-ppr` | 49 | 104 | 146 | 57 | 38 | 32 |
| `dynasty-sf` | 68 | 124 | 174 | 73 | — | — |

---

## 4. Stack

Chosen for zero-backend, instant-load, offline-capable. If you want something different,
say so.

**Confirmed in Phase 2** — every row below is now actually in use, not a proposal.

| Concern | Choice | Why |
|---|---|---|
| Build | Vite | Fast dev server, static output, no server runtime needed |
| UI | React 19 + TypeScript (strict) | Familiar, typed domain model |
| Styling | Tailwind CSS v4 | Utility-first; keeps the design tokens in one place |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Accessible (keyboard reorder), no legacy HTML5 DnD quirks |
| State | Zustand | Small store, no boilerplate, easy to snapshot for undo |
| Persistence | SQLite — `@sqlite.org/sqlite-wasm` on the **`opfs-sahpool`** VFS, in a Web Worker | Phase 4. Relational, generous quota, and needs **no COOP/COEP headers**, so GitHub Pages stays a hosting target |
| Legacy persistence | `localStorage` (JSON) | Phases 0–3's store. Still live code: the Phase 4.4 migration source and the legacy `.json` import path |
| SQL engine in tests | `node:sqlite` (`DatabaseSync`, Node 22 builtin) | Real SQLite for `repository`/`schema` tests without OPFS. Test-only — never shipped |
| Tests | Vitest + React Testing Library | Unit + component. No browser-automation layer — see below |
| Virtualisation | Hand-rolled (`features/board/virtual-window.ts`) | ~100 lines of fixed-height windowing; the hard part is where it meets dnd-kit, which a library would obscure, not solve |
| Hosting | Any static host (Vercel / Netlify / GH Pages) | Output is plain files |

**Phase 3 added no runtime dependency.** Undo/redo, tier bands, dark mode, density, the
responsive pass, the accessibility work and virtualisation are all built on the rows above.

**Phase 4 added exactly one:** `@sqlite.org/sqlite-wasm`. It is loaded *inside the worker*, so the
864 kB wasm binary and the 224 kB worker chunk are separate assets fetched off the first-paint
path — the entry chunk does not contain a single sqlite symbol. Verify that with a `grep` of
`dist/assets/index-*.js` after any change to `state/db/`, because a stray main-thread import of the
package would silently move ~1 MB onto the critical path.

**The VFS is not interchangeable.** `opfs` (the standard one) requires COOP/COEP response headers
for `SharedArrayBuffer`, and GitHub Pages cannot set headers — choosing it would silently drop a
hosting target this file promises. `kvvfs` is `localStorage` with SQL overhead on top.
`opfs-sahpool` needs no headers and is the fastest of the three; its single-connection,
no-multi-tab limitation is irrelevant for a single-user board. Do not change it without
re-arguing that table.

**No Playwright, and no other browser-automation layer** (decided 2026-08-18, Phase 2). This was
previously listed as "deferred to a later phase"; it is now **dropped**, so that nobody adds it
out of a sense of obligation.

The argument for driving a real browser is that `jsdom` — which implements the DOM tree but does
**no layout**, so `getBoundingClientRect()` returns all zeros — cannot perform a real pointer
drag. True, but it does not follow that we need one:

- The reordering logic is pure and unit-tested (`domain/board.ts`). The only part a drag adds is
  translating dnd-kit's player ids into list indices, and that is now the pure, tested
  `resolveDragMove` rather than untestable code inside the drag handler.
- Automated browser tests earn their cost through *scale of consequence*: many users, many
  contributors, regressions nobody notices for a week. This is a single-user board its author
  opens before every draft. A broken drag is obvious in about one second.
- Phase 3.7's "no dropped frames while dragging a 400-row board" is a **measurement**, not an
  assertion. Chrome's Performance panel answers it by hand in two minutes, and gives you a flame
  chart a passing test never would.

Revisit only if one of those premises changes — a second user, or a performance problem that
cannot be diagnosed by hand.

---

## 5. Architecture

Layered, one direction of dependency: **data → domain → state → features → app**.
A lower layer never imports from a higher one.

```
fantasy-assist/
├── PROJECT.md
├── docs/
│   ├── MVP-OVERVIEW/
│   │   └── MVP-OVERVIEW.md      # phased feature plan
│   ├── plans/                   # forward-looking: what a phase still owes, open questions
│   └── summary-reports/         # one report per completed phase (what shipped)
├── scripts/                     # build-time tooling, never shipped in the bundle
│   └── fetch-rankings.mjs       # regenerates the datasets (see §3)
├── src/
│   ├── data/
│   │   ├── rankings/            # checked-in JSON datasets (see §3)
│   │   │   ├── redraft-ppr-2026.json
│   │   │   └── dynasty-sf-2026.json
│   │   └── sources/             # RankingSource adapters (local JSON is the default)
│   │       ├── ranking-source.ts    # the interface — the only ingestion seam
│   │       ├── validate-dataset.ts  # parse-and-throw on malformed data
│   │       └── local-json-source.ts # default adapter: static JSON import
│   ├── domain/                  # pure TS: types + logic, zero React, zero I/O
│   │   ├── player.ts            # Player, Position, Format
│   │   ├── board.ts             # initialOrder, reconcileOrder, moveInFilteredView, ranks
│   │   ├── filters.ts           # position / search / availability predicates
│   │   ├── history.ts           # generic History<T> undo/redo stacks (Phase 3.1)
│   │   ├── tiers.ts             # tierStartIds (3.3) + resolveTierStarts / custom tiers (4.9)
│   │   ├── boards.ts            # BoardMeta, name validation, nextBoardName (4.6)
│   │   ├── fractional-order.ts  # keyBetween / needsRenormalisation / renormalise (4.5)
│   │   ├── dataset-refresh.ts   # reconcileWithReport — what changed and why (4.12)
│   │   ├── scarcity.ts          # per-position remaining counts (4.10)
│   │   └── bye-weeks.ts         # bye collisions among drafted players (4.11)
│   ├── state/                   # Zustand store + ALL persistence
│   │   ├── db/                  # the SQLite layer (Phase 4) — see its own note below
│   │   │   ├── sql-executor.ts      # the seam: all/run/transaction + DatabaseError
│   │   │   ├── schema.ts            # forward-only MIGRATIONS as data
│   │   │   ├── commands.ts          # the DbCommand discriminated union
│   │   │   ├── repository.ts        # EVERY query in the app, against SqlExecutor
│   │   │   ├── protocol.ts          # worker message types + pure handleRequest
│   │   │   ├── client.ts            # main-thread proxy: postMessage + id correlation
│   │   │   ├── worker.ts            # sqlite3 + opfs-sahpool bootstrap. NO SQL LIVES HERE
│   │   │   └── *.test-support.ts    # node:sqlite executor + in-process client, tests only
│   │   ├── rankings.ts          # memoized RankingSource accessor — state/'s only @/data import
│   │   ├── persistence.ts       # LEGACY localStorage read/write + v1→v2 migration; now the
│   │   │                        #   4.4 migration source and the legacy .json import path
│   │   ├── migrate-local-storage.ts # one-time, non-destructive localStorage → SQLite (4.4)
│   │   └── board-store.ts       # createBoardStore() + initialiseBoardStore() + the singleton
│   ├── features/                # feature-scoped React: component + hooks + styles together
│   │   ├── board/               # board.tsx, player-row.tsx, board-actions.tsx, row-grid.ts,
│   │   │                        #   board-io.tsx, use-history-shortcuts.ts,
│   │   │                        #   virtual-window.ts + use-virtual-rows.ts (3.7),
│   │   │                        #   player-note.tsx (4.7), row-overflow.tsx,
│   │   │                        #   dataset-refresh-banner.tsx (4.12)
│   │   ├── boards/              # board-switch, board-manager, format-labels (4.6)
│   │   ├── filters/             # position-tabs, search-box, availability-toggle, watched (4.8)
│   │   ├── insights/            # scarcity-panel (4.10), bye-week-panel (4.11) — read-only views
│   │   └── preferences/         # theme + density toggles, use-apply-preferences (Phase 3.4)
│   ├── ui/                      # generic presentational primitives (Button, ConfirmButton,
│   │                            #   ToggleGroup, LiveRegion, useReducedMotion, useMediaQuery)
│   │                            #   — these must not know what a Player is
│   ├── app/                     # App shell, layout, providers, routing if it ever appears
│   └── main.tsx
└── tests/                       # integration tests; unit tests sit beside their source
```

**Boundaries that matter:**

- `domain/` is pure and synchronous. If it imports React or touches `window`, it's in the
  wrong layer. This is what makes the ranking logic testable without a DOM.
- `state/` is the only place that talks to storage — SQLite *and* `localStorage`.
- **`state/db/`'s seam is `SqlExecutor`, not the worker.** Every query lives in `repository.ts`
  written against that interface, which is why `node:sqlite` can exercise it for real in the test
  suite. `worker.ts` is a bootstrap and a `switch`: it holds no SQL text and no business rules, and
  it is the ONLY file in the project outside the test suite's reach. Putting a query there puts it
  outside the tests — that is the one rule this layer has.
- `features/` may import `domain`, `state`, and `ui`. `ui/` imports none of them — a `ui/`
  component that knows what a Player is has leaked.
- New top-level directories require justification in your response, per the global rules.

### Domain model (shape, not final schema)

```ts
type Position = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DST';
type Format   = 'redraft-ppr' | 'dynasty-sf';

interface Player {
  id: string;            // stable across datasets and formats
  name: string;
  position: Position;
  team: string;
  baseRank: number;      // as published by the source — never mutated
  tier?: number;
  byeWeek?: number;
  age?: number;          // dynasty-relevant
}

// Phase 4: a board is a named, user-created thing with a format, not one-per-format.
interface BoardSlice {
  id: string; name: string; format: Format; createdAt: string;
  order: string[];                 // player ids — YOUR ranking; the source of truth for display
  sortKeys: Map<string, number>;   // fractional keys, so a drag is ONE database UPDATE (4.5)
  drafted: Set<string>;            // crossed-off player ids
  watched: Set<string>;            // 4.8
  notes: Map<string, string>;      // 4.7
  tierBreaks: Set<string>;         // 4.9 — ids that START a custom tier
}
```

The store holds `boards: Record<string, BoardSlice>` keyed by **board id**, plus `boardIds` and
`activeBoardId`. `activeBoard(state)` is the selector — there is no `state.activeFormat` any more;
a format is a property of a board.

`baseRank` is immutable; user customization lives entirely in `order`. That separation is
what makes "reset to expert rankings" a one-line operation and keeps dataset refreshes from
clobbering your edits.

### Persistence (Phase 4: SQLite; Phases 0–3's `localStorage` is now legacy)

**The live store is a SQLite database** in a Web Worker on the `opfs-sahpool` VFS, written only by
`src/state/db/`. Its schema is at version 1 and lives in `schema.ts` as forward-only migration
data:

```sql
board        (id TEXT PK, name, format CHECK(...), created_at)
board_player (board_id REFERENCES board ON DELETE CASCADE, player_id,
              sort_order REAL, drafted, watched, tier_break, note,
              PRIMARY KEY (board_id, player_id))
app_setting  (key TEXT PK, value TEXT)   -- activeBoardId, theme, density, the filters
schema_version (version INTEGER)
```

- **`PRAGMA foreign_keys = ON` is set and verified at open time.** SQLite defaults it *off*, which
  makes the `ON DELETE CASCADE` above silently inert. `migrate` throws if the pragma did not take.
- **`sort_order` is `REAL`, not a dense integer, and that is load-bearing.** Dragging a player from
  rank 400 to rank 2 is ONE `UPDATE` — the midpoint of its two new neighbours — instead of ~398.
  The arithmetic is pure and lives in `domain/fractional-order.ts`; `needsRenormalisation` is the
  guard callers run *before* `keyBetween`, escalating to a whole-board rewrite when a gap closes.
  Never replace this with integer ranks to "simplify" it.
- **Schema changes are a NEW migration version**, never an edit to v1. A database written by a
  *newer* app throws rather than being downgraded.
- **`search` is still deliberately not persisted.** A search box still holding "mahomes" after a
  refresh mid-draft hides the board for no reason. Position, availability and watched-only are.

**The async boundary (4.3) has three rules, in priority order:**

1. **Boot gates once, explicitly.** `createBoardStore()` builds an inert `status: 'loading'` store
   synchronously — no client, no I/O, safe in `jsdom`. `initialiseBoardStore()` does the async
   work and `App` gates on `status`. "The UI must never await a query to paint a row" is about the
   interaction path; gating the *first* paint is what stops a user editing a board that hydration
   is about to overwrite.
2. **Reads never touch the database after boot.** `load()` returns every board and setting in one
   message; the UI reads the store synchronously, exactly as in Phase 3.
3. **Writes are fire-and-forget with a visible failure.** A rejected command sets
   `persistenceError` and `App` shows a `role="alert"` banner. Memory is deliberately **not**
   rolled back — silently reverting a user's edit under them is worse than a visible "not saved".

**OPFS unavailable is a hard failure.** Private browsing surfaces as `status: 'error'`. There is no
fallback to `localStorage`: a silent downgrade means a board that quietly stops persisting, which
is the worst outcome available.

**The legacy `localStorage` key (`fantasy-assist.state`, `schemaVersion` 2, frozen).**
`src/state/persistence.ts` is still live code, for exactly two jobs: it is the 4.4 migration source
and the legacy `.json` import path. Its rules still apply where it is used — absent key = normal
cold start, present-but-corrupt = throws `PersistedStateError` naming the key.

- **The 4.4 migration is one-time and non-destructive: the key is NEVER cleared automatically.**
  It parses through the *existing* `loadPersistedState`, so the v1→v2 migration is inherited free
  with no second parser to drift. Clearing it is a user action behind a confirm in `board-io.tsx`.
  One documented exception to fail-fast: a *corrupt* legacy key is downgraded to a
  `persistenceError` banner rather than blocking boot — it is a backup nobody is reading, not the
  live store.
- **Export (4.13) is the raw `.sqlite` byte image**, which supersedes 3.8's JSON. Import still
  accepts both, so a Phase 3.8 backup is not orphaned. Because OPFS is not user-inspectable, this
  export is the *only* hand-recovery path — treat it as load-bearing, not a nicety.
- **Persisted order is reconciled against the dataset at every boot** (`domain/dataset-refresh.ts`
  `reconcileWithReport`): unknown ids dropped, duplicates collapsed, new players inserted at their
  `baseRank`. Removed players take their notes, watchlist flags and tier breaks with them, which is
  why 4.12 *reports* the reconcile in a banner instead of doing it silently.

## 6. Conventions

- TypeScript `strict`. No `any` in committed code.
- Functional components with hooks. No class components.
- Named exports; default export only for a route/page module.
- Files `kebab-case.ts(x)`; components `PascalCase`; hooks `useThing`.
- Domain logic gets unit tests. UI gets a component test for interaction, not for markup.
- **Fail fast** (global rule): no silent fallbacks around missing/malformed dataset files —
  a bad dataset should throw loudly at load, not render an empty board.
- **No TODOs** in committed code.
- Accessibility is not a later phase: every row is keyboard-reachable, drag has a keyboard
  equivalent, crossed-off state is conveyed by more than colour. Since Phase 3.6: colour
  contrast is **measured, not eyeballed** (AA — 4.5:1 body text, 3:1 large text and UI
  indicators, in *both* themes) before a token ships, and any state change that happens
  off-screen or makes a row vanish is announced through `ui/LiveRegion`.
- **Row height is single-source** (`features/board/row-grid.ts` `resolveRowHeight`). The
  virtualiser positions rows by arithmetic and CSS paints them; a second place computing a
  height means overlapping or gapped rows. Never infer it from a padding class. Since Phase 4 the
  row also carries a star, a note and a tier-break control: anything new added to a row must be an
  absolutely-positioned overlay or a narrow-width swap, never something that changes row height.
- **A feature must not simply disappear below a breakpoint.** Hiding a *text column* at 375px is
  fine; hiding a *control* means the feature does not exist on a phone, which §3.5 and the
  accessibility rule both forbid. Collapse it into the row-overflow menu instead. Prefer a JS
  conditional over a CSS-hidden duplicate — two mounted controls sharing an accessible name are
  ambiguous to assistive tech and to a `jsdom` test query, which applies no stylesheet.
- **Test against a real SQL engine, not a mock.** `state/db/*.test.ts` and every store/component
  test boot through `db/*.test-support.ts`, which is `node:sqlite` behind the `SqlExecutor`
  interface. A mock executor would fake exactly the behaviour most likely to be wrong — this is
  how the `ON DELETE CASCADE`, transaction-rollback and journal-sibling-file bugs were caught.

---

## 7. Commands

Verified in Phase 0.

```bash
npm install
npm run dev         # Vite dev server (http://localhost:5173)
npm run build       # tsc -b && vite build -> dist/
npm run preview     # serve the production build locally
npm run test        # vitest run (single pass, CI-friendly)
npm run test:watch  # vitest (watch mode)
npm run typecheck   # tsc -b --noEmit
npm run lint        # eslint . (zero errors, zero warnings)
npm run format      # prettier --write .
```

---

## 8. Do-not-touch

- `src/data/rankings/*.json` — **generated artifacts**, not hand-edited source. Change them
  only by running `npm run fetch:rankings` deliberately and committing the diff. Never rewrite
  them programmatically as a side effect of another task, and never hand-patch a single player
  (the next regeneration silently reverts it).
- `LICENSE`.
- The board's **scroll ownership**: `App.tsx`'s `<Board />` wrapper is `overflow-hidden` and
  `Board` scrolls its own region internally, because the virtualiser needs a ref to the exact
  element that scrolls. Changing that wrapper back to `overflow-y-auto` silently breaks
  windowing — the list will look fine and mount every row.
- No new top-level directories without flagging it (global rule §Architecture).
- No network calls to authenticated or paywalled endpoints (§3).
- **`src/state/db/worker.ts` must never contain SQL or business rules.** It is the only file the
  test suite cannot reach; every line added to it is a line nothing verifies. Queries go in
  `repository.ts` behind `SqlExecutor`.
- **Never import `@sqlite.org/sqlite-wasm` from the main thread.** It is worker-only by design, and
  a main-thread import silently moves ~1 MB of wasm onto the first-paint path. Check with
  `grep -c sqlite3InitModule dist/assets/index-*.js` (must be 0) after touching `state/db/`.
- **The `opfs-sahpool` VFS choice** — see §4. Changing it to `opfs` requires COOP/COEP headers and
  silently drops GitHub Pages as a hosting target.
- **The legacy `localStorage` key is never cleared programmatically** as a side effect of anything.
  It is a user action behind a confirm. Until someone has verified OPFS persistence by hand
  (`docs/plans/phase-4-remaining.md` §1.1), it is also the only rollback path.
