# Phase 4 — implementation plan

Companion to [`../MVP-OVERVIEW/MVP-OVERVIEW.md`](../MVP-OVERVIEW/MVP-OVERVIEW.md) §Phase 4.
That file says *what* Phase 4 is; this file says *how it is built and in what order*.

> **Gate acknowledged.** The MVP overview gates Phase 4 on real draft usage, and open question 6
> says to drop it rather than build it for its own sake if notes and multiple boards never get
> used in anger. That gate has not been satisfied — no live draft has been run. This plan is
> executed on explicit instruction; the gate is recorded, not silently ignored.

---

## 1. The shape of the problem

Phase 4 is two things bolted together and they have very different risk profiles:

- **4.1–4.5 — the persistence swap.** Replace a synchronous `localStorage.getItem` with an
  asynchronous, Worker-hosted, OPFS-backed SQLite database. This changes the *shape* of the
  `state/` API and touches every consumer of it. Almost none of it can be tested in `jsdom`.
- **4.6–4.13 — the features.** Ordinary React and pure-domain work, each of which is small once
  the row it needs exists in `board_player`.

The plan is organised so the untestable surface is as small as possible, and so that every
feature in 4.6–4.13 lands on top of an already-verified storage layer.

### 1.1 The testability strategy (the load-bearing decision of this plan)

`jsdom` has no OPFS, no real `Worker`, and no `SharedArrayBuffer`. A naive layering — worker owns
SQLite, worker owns the queries — makes 100% of Phase 4's persistence unverifiable, which is not
acceptable for the layer that holds the user's accumulated draft board.

So the SQL is separated from the thing that hosts it:

```
db/sql-executor.ts   interface SqlExecutor { exec(sql, params): Row[] }   ← the seam
db/schema.ts         migrations as data, applied through a SqlExecutor    ← testable
db/repository.ts     every query in the app, written against SqlExecutor  ← testable
db/commands.ts       the discriminated-union command set + dispatcher     ← testable
db/protocol.ts       request/response message types (pure types)          ← testable
db/client.ts         main-thread proxy: postMessage + id correlation      ← testable
db/worker.ts         sqlite3 + opfs-sahpool bootstrap, message loop       ← NOT testable
```

`worker.ts` is the only file that cannot be tested, and it is deliberately kept to a bootstrap
and a `switch`: it contains no query text and no business rules.

Tests supply a **real SQL engine** rather than a mock: `node:sqlite`'s `DatabaseSync`, built into
Node 22.19 (this project's toolchain). Same engine, same dialect, no OPFS. So migrations,
constraints, `ON DELETE CASCADE`, fractional-order updates and every query are exercised for real
in `npm run test` — the thing a mock executor would have faked is exactly the thing most likely
to be wrong.

**Node 22's `node:sqlite` is flagged experimental.** It is used only in tests, never shipped; the
shipped engine is `@sqlite.org/sqlite-wasm`. If it is ever removed, the fallback is to run the
same repository tests against `sqlite-wasm`'s Node build (`dist/node.mjs`), which the package
already exports.

---

## 2. Architecture — where the new code goes

No new **top-level** directory. Everything lands inside the existing layers of `PROJECT.md` §5.
Two structural additions inside those layers, both flagged here:

1. **`src/state/db/`** — a subdirectory of `state/`, because §5 already makes `state/` the only
   layer that talks to storage, and this is now eight files rather than one. Putting it beside
   `persistence.ts` at the top of `state/` would bury `board-store.ts` in engine plumbing.
2. **`src/features/boards/`** replaces **`src/features/format/`** — 4.6 makes "which board am I
   looking at" the primary selector and demotes format to a property of a board. `FORMAT_LABELS`
   moves across; `format-switch.tsx` is superseded by `board-switch.tsx` and deleted.

```
src/
├── domain/                       # still pure, still synchronous, still zero I/O
│   ├── fractional-order.ts   NEW  keyBetween / needsRenormalisation / renormalise   (4.5)
│   ├── dataset-refresh.ts    NEW  reconcileWithReport — what changed and why        (4.12)
│   ├── scarcity.ts           NEW  per-position remaining counts                     (4.10)
│   ├── bye-weeks.ts          NEW  bye collisions among drafted players              (4.11)
│   ├── boards.ts             NEW  BoardMeta, board id generation, name validation   (4.6)
│   └── tiers.ts              EXT  resolveTierStarts(order, players, customBreaks)   (4.9)
├── state/
│   ├── db/                   NEW  see §1.1
│   ├── persistence.ts        KEPT  localStorage reader — now only a migration source
│   ├── migrate-local-storage.ts NEW  one-time, non-destructive import               (4.4)
│   └── board-store.ts        REWRITTEN  multi-board, async hydration, write-through
└── features/
    ├── boards/               NEW  board-switch, board-manager, format-labels        (4.6)
    ├── board/                EXT  note button/editor, watch star, tier-break control
    ├── filters/              EXT  watchlist filter                                  (4.8)
    └── insights/             NEW  scarcity panel, bye-week panel                    (4.10/4.11)
```

Dependency direction is unchanged: `data → domain → state → features → app`. `domain/` gains no
imports. `features/insights/` reads `state` and `domain` like every other feature.

---

## 3. Data model

### 3.1 Schema (migration v1 — the SQLite schema's own version, independent of the
`localStorage` `schemaVersion`, which stays frozen at 2)

```sql
CREATE TABLE schema_version (version INTEGER NOT NULL);

CREATE TABLE board (
  id         TEXT    PRIMARY KEY,
  name       TEXT    NOT NULL,
  format     TEXT    NOT NULL CHECK (format IN ('redraft-ppr', 'dynasty-sf')),
  created_at TEXT    NOT NULL
);

CREATE TABLE board_player (
  board_id   TEXT    NOT NULL REFERENCES board(id) ON DELETE CASCADE,
  player_id  TEXT    NOT NULL,
  sort_order REAL    NOT NULL,
  drafted    INTEGER NOT NULL DEFAULT 0 CHECK (drafted IN (0, 1)),
  watched    INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  tier_break INTEGER NOT NULL DEFAULT 0 CHECK (tier_break IN (0, 1)),
  note       TEXT,
  PRIMARY KEY (board_id, player_id)
);

CREATE INDEX board_player_order ON board_player (board_id, sort_order);

CREATE TABLE app_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

Two deviations from the §4.5 sketch, both deliberate:

- **`board.id` is `TEXT`, not `INTEGER PRIMARY KEY`.** A board id is generated on the client and
  has to survive an export/import round trip into a database that may already hold a board with
  that rowid. A collision-free opaque string sidesteps the whole class of problem, and the id is
  never displayed.
- **`board_player.tier_break`** is added for 4.9. Custom tiers are per player per board, which is
  exactly the grain this table already has; a separate `tier` table would add a join for a
  boolean.

`app_setting` holds `activeBoardId`, `theme`, `density`, `filterPosition`, `filterAvailableOnly`,
`filterWatchedOnly`. `search` stays unpersisted (`PROJECT.md` §5).

`PRAGMA foreign_keys = ON` is set on every connection — SQLite defaults it *off*, so the
`ON DELETE CASCADE` above is inert without it. The repository asserts it at open time.

### 3.2 `sort_order` is `REAL` — and the arithmetic lives in `domain/`

Dragging a player from rank 400 to rank 2 must be one `UPDATE`, not 398. The new value is the
midpoint of its two neighbours. IEEE-754 doubles allow ~50 successive splits in one gap, so
`needsRenormalisation` watches the gap and `renormalise` rewrites the board to evenly spaced
integers when it gets too small.

All three functions are pure and live in `domain/fractional-order.ts`, unit-tested against the
adversarial case: 60 consecutive drops into the same gap must renormalise rather than collapse
two players onto an equal key. Getting this wrong corrupts the *order* of the board — the one
thing this app exists to preserve — and it would do it silently.

The in-memory store keeps `order: string[]` for rendering (every Phase 2–3 code path keeps
working untouched) **and** `sortKeys: Map<string, number>` to compute the next midpoint.

### 3.3 What the store holds now

```ts
interface BoardSlice {
  id: string; name: string; format: Format; createdAt: string;
  order: string[];                 // display order — unchanged from Phase 2
  sortKeys: Map<string, number>;   // fractional keys, for single-row UPDATEs
  drafted: Set<string>;
  watched: Set<string>;            // 4.8
  notes: Map<string, string>;      // 4.7
  tierBreaks: Set<string>;         // 4.9 — ids that START a custom tier
}
```

`boards: Record<Format, BoardSlice>` becomes `boards: Record<string, BoardSlice>` keyed by board
id, plus `boardIds: string[]` for stable display order and `activeBoardId: string`.

---

## 4. The async boundary (4.3) — how the UI never awaits

Three rules, in priority order:

1. **Boot gates once, explicitly.** The store carries `status: 'loading' | 'ready' | 'error'`.
   `App` renders a loading shell, then the board. This is one await at startup, not per row —
   `PROJECT.md` §4's "the UI must never await a query to paint a row" is about the interaction
   path, and gating the first paint is what stops a user editing a board that is about to be
   overwritten by hydration.
2. **Reads never touch the database after boot.** `load()` returns the entire persisted state in
   one message (~900 rows across two seeded boards). Everything the UI renders is read from the
   Zustand store synchronously, exactly as in Phase 3.
3. **Writes are fire-and-forget with a visible failure.** A mutation updates memory synchronously
   and posts a command. A rejected command sets `persistenceError`, and `App` renders a
   non-dismissible banner. Fail fast (`PROJECT.md` §6): no retry, no swallow, no silent
   downgrade to `localStorage`.

Rule 3's converse matters as much: **OPFS being unavailable is a hard failure.** Private-browsing
restrictions surface as `status: 'error'` with the engine's own message. Falling back to
`localStorage` would mean the user's board quietly stops persisting, which is the worst outcome
available.

### 4.1 Command set

The worker takes a discriminated union rather than a generic "run this SQL", so the SQL never
crosses a message boundary:

| Command | SQL cost | Raised by |
|---|---|---|
| `setDrafted` / `setWatched` / `setTierBreak` / `setNote` | 1 UPDATE | 4.7, 4.8, 4.9, cross-off |
| `moveSortKey` | 1 UPDATE | a drag / Alt+↑↓ |
| `renormaliseOrder` | 1 UPDATE per row, in a transaction | rare, off the interaction path |
| `replaceBoardRows` | DELETE + bulk INSERT, in a transaction | undo/redo, reset, import |
| `createBoard` / `renameBoard` / `deleteBoard` | 1 statement (+ cascade) | 4.6 |
| `setSetting` | 1 UPSERT | filters, theme, density, active board |

Undo/redo stays an in-memory snapshot stack (Phase 3.1, capped at 50, unpersisted) and writes its
restored state back through `replaceBoardRows`. Widening the snapshot to cover notes/watch/tiers
is a change from Phase 3 and is intended: those are board edits, and a misclick on a note should
be as undoable as a misclick on cross-off.

---

## 5. Migration from `localStorage` (4.4)

One-time and **non-destructive**:

1. On boot, if the database has no `board` rows and `fantasy-assist.state` exists, parse it with
   the *existing* `loadPersistedState` — including its v1→v2 migration, which is inherited free.
2. Seed two boards, "Redraft PPR" and "Dynasty Superflex", from `boards['redraft-ppr']` and
   `boards['dynasty-sf']`; carry `filters` and `preferences` into `app_setting`.
3. **Leave the `localStorage` key exactly as it was.** It is the only rollback path, and OPFS is
   not user-inspectable. A one-line notice offers to clear it; nothing clears it automatically.
4. A cold start with no `localStorage` key seeds the same two boards from `initialOrder`.

---

## 6. Features (4.6–4.13)

| # | Feature | Where | Notes |
|---|---|---|---|
| 4.6 | Multiple boards | `features/boards/` | Create / rename / duplicate / delete; format fixed at creation. Deleting the last board is refused, not silently allowed. |
| 4.7 | Notes | `features/board/player-note.tsx` | Inline editor on a row; commits on blur/Enter, not per keystroke. An indicator shows a row has a note when collapsed. |
| 4.8 | Watchlist | `features/board/`, `features/filters/` | Star toggle on the row, "Watched only" filter beside "Available only". |
| 4.9 | Custom tiers | `features/board/` | "Start a tier here" on a row. A board with ≥1 custom break uses custom breaks *exclusively*; with none it inherits the source's `tier`. All-or-nothing, because a half-custom scheme cannot be read at a glance — which is the entire point of 3.3. |
| 4.10 | Positional scarcity | `features/insights/scarcity-panel.tsx` | Per position: undrafted remaining, remaining in the current top tier, and the board rank of the next one. Pure aggregation in `domain/scarcity.ts` over the bundled dataset (open question 5: rankings stay bundled, joined in JS). |
| 4.11 | Bye-week view | `features/insights/bye-week-panel.tsx` | Collisions among *drafted* players, grouped by week, flagging ≥2 at the same position. `byeWeek` is optional in the dataset; players without one are reported as a count, not hidden. |
| 4.12 | Dataset refresh | `domain/dataset-refresh.ts` + a banner | Hydration compares persisted ids against the loaded dataset: new players inserted at `baseRank`, retired players dropped (with their notes/flags), duplicates collapsed. Reported once, dismissibly — a silent reconcile is how a dataset refresh eats a note without anyone noticing. |
| 4.13 | Export / import | `features/board/board-io.tsx` | Export is now the raw `.sqlite` byte image. Import accepts `.sqlite` **and** the legacy Phase 3.8 `.json`, which still routes through `parseStateJson` + the 4.4 seeding path. Supersession without orphaning old backups. |

---

## 7. Build order

| Stage | Content | Depends on |
|---|---|---|
| A | `domain/`: fractional-order, dataset-refresh, scarcity, bye-weeks, boards, tiers extension | — |
| B | `state/db/`: executor, schema, repository, commands, protocol, client, worker + Vite build proof | — |
| C | Store rewrite, 4.4 migration, App boot gate + error/loading states | A, B |
| D | 4.6, 4.7, 4.8, 4.9 | C |
| E | 4.10, 4.11, 4.12, 4.13 | C |
| F | `PROJECT.md` update + summary report | A–E |

A and B are independent and run in parallel. D and E both touch `player-row.tsx` and `App.tsx`,
so they run in sequence rather than racing on the same files.

**Stage B opened with a build proof**, before any query was written: a worker that opens an
`opfs-sahpool` database must survive `npm run build` and appear as its own chunk with the wasm
as a separate asset. Had `@sqlite.org/sqlite-wasm` needed COOP/COEP headers to bundle under
Vite 7, the phase would have stopped there — that would invalidate §4.1's VFS choice, which is
the premise the whole phase rests on.

> **Result: pass.** Only `optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] }` was needed, and
> that affects the dev server only. The entry chunk went 373.96 kB → 374.07 kB; the worker
> (215.69 kB) and `sqlite3.wasm` (864.75 kB) are separate assets, fetched by the worker rather
> than the entry. The MVP overview's "current bundle of 301 KB" figure was already stale — the
> pre-Phase-4 baseline measured here is 374 kB.

## 8. Definition of done

- `npm run test`, `typecheck`, `lint`, `build`, `prettier --check` all clean.
- The SQLite schema, its migrations, and every repository query are exercised against a real
  SQLite engine in the test suite.
- Main-thread bundle does not regress materially; the wasm binary is a lazily fetched worker
  asset, not part of the entry chunk.
- A board created before Phase 4 loads with its order and drafted set intact, and its
  `localStorage` key is still there afterwards.
- Every item 4.1–4.13 is implemented, or is explicitly recorded as not shipped with the reason.

## 9. Out of scope

Phase 3's outstanding hand-verification (`phase-3-remaining.md` §1) is unaffected by this phase
and still outstanding. Rookie draft picks (MVP open question 4) stay dropped: `Position` still
has no slot for them, and 4.6–4.13 give no new reason to add one.
