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
say so — this is the working assumption, not a fixed decision.

| Concern | Choice | Why |
|---|---|---|
| Build | Vite | Fast dev server, static output, no server runtime needed |
| UI | React 19 + TypeScript (strict) | Familiar, typed domain model |
| Styling | Tailwind CSS v4 | Utility-first; keeps the design tokens in one place |
| Drag & drop | `@dnd-kit/core` + `@dnd-kit/sortable` | Accessible (keyboard reorder), no legacy HTML5 DnD quirks |
| State | Zustand | Small store, no boilerplate, easy to snapshot for undo |
| Persistence | `localStorage` (JSON) | No server; survives refresh; trivially exportable |
| Tests | Vitest + React Testing Library | Unit + component; Playwright deferred to a later phase |
| Hosting | Any static host (Vercel / Netlify / GH Pages) | Output is plain files |

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
│   │   ├── board.ts             # reorder, cross-off, availability, tiering
│   │   └── filters.ts           # position / search predicates
│   ├── state/                   # Zustand stores + localStorage persistence + undo
│   ├── features/                # feature-scoped React: component + hooks + styles together
│   │   ├── board/               # the ranked list, rows, drag handles
│   │   ├── filters/             # position tabs, search box, availability toggle
│   │   └── format/              # Redraft PPR ↔ Dynasty SF switcher
│   ├── ui/                      # generic presentational primitives (Button, Chip, Toast)
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
  equivalent, crossed-off state is conveyed by more than colour.

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
- No new top-level directories without flagging it (global rule §Architecture).
- No network calls to authenticated or paywalled endpoints (§3).
