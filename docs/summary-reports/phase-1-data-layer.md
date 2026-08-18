# Phase 1 — Data layer

Status: **done**, independently verified on the main thread. Both formats load, validate, and
render as a static list; a corrupt dataset fails loudly at startup — the done-when criteria in
`docs/MVP-OVERVIEW/MVP-OVERVIEW.md`.

## Headline: the "paywalled" blocker was wrong

Phase 1 was documented as **blocked**. `PROJECT.md` §3 carried a "Verified constraint
(2026-08-18): Flock exposes no public rankings endpoint... paid subscription feature", and the
MVP plan said Phase 1 would ship a placeholder dataset until a human hand-supplied real numbers.

That was a false negative, and re-checking cost about five minutes. Flock serves its full
consensus rankings from a **public, unauthenticated** endpoint:

```
GET https://api.flockfantasy.com/rankings?format=REDRAFT&pickType=general
GET https://api.flockfantasy.com/rankings?format=SUPERFLEX&pickType=general
```

A logged-out caller gets `subscribed: false` and still receives every player.

**Why the original check failed — worth remembering.** There are two different sites:

| Host | App | What it serves |
|---|---|---|
| `www.flockfantasy.com` | Next.js | Marketing page. Sitemap lists one URL; `/rankings` 404s; nav links go to Sign In. |
| `flockfantasy.com` (apex) | Vite SPA | The real product, which calls `api.flockfantasy.com`. |

The original check probed only the `www` host, found a one-URL sitemap and a 404, and concluded
the data was gated. Finding the truth meant pulling the apex SPA's JS bundle and grepping it for
API paths. **Lesson: a marketing host's sitemap says nothing about the product's API.**

Only the personalised routes actually require auth — confirmed, not assumed:

| Endpoint | Unauthenticated |
|---|---|
| `/rankings` | **200, full data** |
| `/rankings/configurations` | 401 |
| `/rankings/platform` | 401 |

No placeholder dataset was built. Phase 1 ships real 2026 data.

## What was built

### Generator (`scripts/fetch-rankings.mjs`, item 1.2–1.4)

Plain Node ESM, run via `npm run fetch:rankings`. Fetches both endpoints, validates the response,
normalizes, and writes the two dataset files. **The app never calls this API at runtime** — the
datasets are generated, committed, and statically imported.

`scripts/` is a **new top-level directory**, added deliberately: it is build-time tooling and must
not ship inside `src/`. `PROJECT.md` §5's tree has been updated to include it.

### Datasets (committed, with provenance)

| File | Players | Positions |
|---|---|---|
| `redraft-ppr-2026.json` | 426 | QB 49, RB 104, WR 146, TE 57, K 38, DST 32 |
| `dynasty-sf-2026.json` | 439 | QB 68, RB 124, WR 174, TE 73 |

### Domain + ingestion seam (items 1.1, 1.5, 1.6)

- `src/domain/player.ts` — `Player`, `Position`, `Format`, `BoardState`, plus `POSITIONS` /
  `FORMATS` tuples and `isPosition` / `isFormat` guards. Pure, zero casts, zero `any`.
- `src/data/sources/ranking-source.ts` — the `RankingSource` interface, the **only** ingestion
  seam. `load` is synchronous because there is no runtime network I/O.
- `src/data/sources/validate-dataset.ts` — `parseRankingDataset(raw: unknown, expectedFormat)`,
  hand-written (no schema library, no new dependency), throwing `DatasetValidationError` with the
  offending field named.
- `src/data/sources/local-json-source.ts` — default adapter. Validation runs at **module load**,
  so a corrupt dataset throws at startup rather than rendering an empty board.

### Static render (item 1.7)

`src/features/board/player-list.tsx` — read-only semantic `<table>` with real `<th scope="col">`
headers. `src/app/App.tsx` loads `redraft-ppr` and shows the count and provenance. No
interactivity: reordering, cross-off, and filtering are all Phase 2.

## Normalization decisions

The upstream shape does not match our domain model. Each of these is a deliberate choice, now
documented in `PROJECT.md` §3:

1. **`baseRank` is derived, never copied.** Upstream `averageRank` is `null` for **all 70 K/DEF
   rows** in redraft (the consensus simply doesn't rank them) and contains ties — 20 in redraft,
   44 in SF. Copying it would have produced null ranks and duplicate ranks. Players are sorted by
   `(averageRank ?? +Infinity, position order, name, id)` and assigned a dense `1..N`. The `id`
   tiebreak is what makes regeneration stable.
2. **Rookie draft picks excluded.** 17 `SUPERFLEX` rows are tradeable picks (`"2027 EARLY 1st"`)
   with `position: null`. `Position` has no slot for them; representing them is a Phase 4
   question, not a data-layer one. Logged as MVP open question 4.
3. **`DEF` → `DST`** to match `Position`. Enforced at the validation boundary, not just applied in
   the generator — verified by injecting a `DEF` into the real dataset and confirming it throws.
4. **`team: null` → `"FA"`** (free agents).
5. **Optional fields omitted, never nulled.** `tier` / `byeWeek` / `age` are absent when upstream
   is null. The validator **rejects an explicit `null`**, so "missing" and "broken" stay distinct.

## Verification

Re-run on the main thread after implementation, not taken from agent self-reports:

| Command | Result |
|---|---|
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | clean — 0 errors, 0 warnings |
| `npm run test` | `Test Files 4 passed (4)` / `Tests 50 passed (50)` |
| `npm run build` | 39 modules, `dist/` produced (8.41 kB CSS, 301.16 kB JS / 82.53 kB gzip) |
| `npx prettier --check .` | clean |
| `npm run dev` | Vite ready in 122 ms; `curl localhost:5173` → HTTP 200 |

Beyond the suite, the validator was probed against the **real 426-player dataset** (not synthetic
fixtures) by injecting five corruptions. All five threw `DatasetValidationError`:

| Injected corruption | Caught |
|---|---|
| Duplicate player id | yes |
| Player spliced out of the middle (rank gap) | yes |
| Position corrupted to `DEF` | yes |
| Optional field set to `null` | yes |
| Dataset loaded as the wrong format | yes |

## Defects found during verification

**1. `scripts/**/*.mjs` was completely unlinted.** `eslint .` had no config block matching `.mjs`,
so the file was parsed under no rule set at all — `npm run lint` reported clean even with an
unused-variable error deliberately injected. Confirmed in both directions before and after the
fix. A `files: ['scripts/**/*.mjs']` block with Node globals now applies real rules. Phase 0's
"lint passes clean" was true but weaker than it read: the config matched nothing outside `src/`.

**2. `resolveJsonModule` was not enabled** in `tsconfig.app.json`, so the static dataset imports
could not typecheck. Added.

**3. Two files failed `prettier --check`** after the domain agent reported formatting clean.
Fixed on the main thread. Noted because it is a reminder to re-run checks rather than trust a
completion report.

## Deviations to flag

- **`scripts/` is a new top-level directory** (justified above; `PROJECT.md` §5 updated).
- **The generator is deterministic except `provenance.retrievedAt`**, which records real
  wall-clock fetch time and necessarily differs between runs. Two runs were diffed: that single
  line is the only byte that changes.
- **The validator also checks `provenance.playerCount` against the actual array length** — one
  rule beyond the brief's list, kept because a provenance count that disagrees with the data is
  exactly the silent corruption this layer exists to catch.

## Consequences for later phases

- **Phase 3.7 virtualisation is now required, not optional.** Dynasty SF is 439 players, above the
  ~400 threshold `PROJECT.md` §1 set. The whole list renders unvirtualised today.
- **Phase 2.7 must handle a legitimately empty position.** Dynasty SF has **no K and no DST** —
  upstream doesn't rank them for superflex. An empty tab is valid data, not a load failure. The
  integration test asserts this deliberately, so a future dataset refresh that changes it fails
  loudly.
- **Bundle is 301 kB** (82.5 kB gzip) because both datasets are bundled. Acceptable now; if it
  becomes a problem, the `RankingSource` seam is where lazy-loading would go.

## Deliberately left out

- No Zustand store, persistence, or undo (Phase 2 / 3.1).
- No drag-and-drop, cross-off, filtering, search, or format switcher (Phase 2) — Phase 1 renders
  `redraft-ppr` only.
- No virtualisation, tier bands, dark mode, or export/import (Phase 3).
- No representation of tradeable rookie draft picks (Phase 4 candidate).
