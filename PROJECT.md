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
| Format switch | Between drafts | Toggle Redraft PPR ↔ Dynasty SF; each format keeps its own edits |

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
| Persistence | `localStorage` (JSON) | No server; survives refresh; trivially exportable |
| Tests | Vitest + React Testing Library | Unit + component. No browser-automation layer — see below |
| Virtualisation | Hand-rolled (`features/board/virtual-window.ts`) | ~100 lines of fixed-height windowing; the hard part is where it meets dnd-kit, which a library would obscure, not solve |
| Hosting | Any static host (Vercel / Netlify / GH Pages) | Output is plain files |

**Phase 3 added no runtime dependency.** Undo/redo, tier bands, dark mode, density, the
responsive pass, the accessibility work and virtualisation are all built on the rows above.

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
│   └── summary-reports/         # one report per completed phase
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
│   │   └── tiers.ts             # tierStartIds — where a tier band begins (Phase 3.3)
│   ├── state/                   # Zustand store + localStorage persistence
│   │   ├── rankings.ts          # memoized RankingSource accessor — state/'s only @/data import
│   │   ├── persistence.ts       # schema-versioned localStorage read/write + migrations,
│   │   │                        #   Theme/Density, serializeState/parseStateJson (3.8)
│   │   └── board-store.ts       # createBoardStore(storage) + the useBoardStore singleton
│   ├── features/                # feature-scoped React: component + hooks + styles together
│   │   ├── board/               # board.tsx, player-row.tsx, board-actions.tsx, row-grid.ts,
│   │   │                        #   board-io.tsx, use-history-shortcuts.ts,
│   │   │                        #   virtual-window.ts + use-virtual-rows.ts (3.7)
│   │   ├── filters/             # position-tabs, search-box, availability-toggle
│   │   ├── format/              # format-switch + format-labels (Redraft PPR ↔ Dynasty SF)
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
- `state/` is the only place that talks to `localStorage`.
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

interface BoardState {
  format: Format;
  order: string[];       // player ids — YOUR ranking; the source of truth for display
  drafted: Set<string>;  // crossed-off player ids
}
```

`baseRank` is immutable; user customization lives entirely in `order`. That separation is
what makes "reset to expert rankings" a one-line operation and keeps dataset refreshes from
clobbering your edits.

### Persistence (Phase 2, extended in Phase 3)

One `localStorage` key, `fantasy-assist.state`, written only by `src/state/persistence.ts`:

```jsonc
{
  "schemaVersion": 2,
  "activeFormat": "redraft-ppr",
  "boards": { "redraft-ppr": { "order": [...], "drafted": [...] }, "dynasty-sf": { ... } },
  "filters": { "position": "ALL", "availableOnly": true },
  "preferences": { "theme": "system", "density": "comfortable" }
}
```

- **`search` is deliberately not persisted.** A search box still holding "mahomes" after a
  refresh mid-draft hides the board for no reason. Position and availability *are* persisted.
- **Absent key = normal cold start** (returns `null`). **Present but corrupt = throws**
  `PersistedStateError` naming the key. There is no silent recovery: quietly discarding a
  half-valid board would throw away exactly the customization this app exists to keep.
- **`schemaVersion` is the migration seam**, and Phase 3 exercised it: adding `preferences`
  bumped the version to `2` via a named, forward-only `migrateV1ToV2`, so a board saved before
  Phase 3 still loads. An unknown version still throws. Copy that shape for v3 — a migration,
  never a fallback.
- **The export file (3.8) *is* this blob.** `serializeState` writes it and `parseStateJson`
  validates it through the same parse-and-migrate path as `loadPersistedState`, so a backup
  taken at v1 imports correctly. There is no second serialization format to keep in sync.
- **Persisted `order` is reconciled against the dataset at load** (`domain/board.ts`
  `reconcileOrder`): unknown ids dropped, duplicates collapsed, new players inserted at their
  `baseRank` position, your customization preserved. Without this a dataset refresh would
  silently corrupt the board. MVP item 4.12 is the full-featured version of this.
- The store writes through on commit only — never per keystroke and never per drag frame.

---

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
  height means overlapping or gapped rows. Never infer it from a padding class.

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
