# Phase 0 — Foundation

Status: **done**, independently verified. `npm run dev` serves a styled empty shell;
`build`, `test`, `typecheck`, and `lint` all pass clean, per the done-when criteria in
`docs/MVP-OVERVIEW/MVP-OVERVIEW.md`.

## Verification

All six checks re-run on the main thread after implementation, not just self-reported:

| Command | Result |
|---|---|
| `npm install` | 286 packages, 0 vulnerabilities |
| `npm run typecheck` | clean, exit 0 |
| `npm run lint` | clean — 0 errors, 0 warnings |
| `npm run test` | `Test Files 1 passed (1)` / `Tests 1 passed (1)` |
| `npm run build` | `30 modules transformed`, `dist/` produced (7.72 kB CSS, 193.87 kB JS) |
| `npm run dev` | Vite ready in 120 ms; `curl localhost:5173` -> HTTP 200 with the app shell |

`dist/` was removed afterwards — it is a build artifact and is gitignored.

## What was built

- Vite + React 19 + TypeScript (strict) scaffold, hand-written (no `npm create vite`).
- Tailwind CSS v4 (CSS-first, `@theme` in `src/app/styles/tokens.css`) — neutral ramp, accent,
  semantic tokens (surface, border, text-primary, text-muted, accent, danger, success),
  spacing/radius/type scales. Dark-mode variables reserved but not wired up (Phase 3.4 owns
  the toggle).
- Directory skeleton exactly per `PROJECT.md` §5, with `export {};` barrels in every layer
  that has no code yet.
- Layer boundaries enforced by ESLint (`no-restricted-imports`), not just documented:
  - `src/domain/**` cannot import `react`, `react-dom`, `zustand`, or `@/state|features|ui|app|data`
  - `src/ui/**` cannot import `@/domain|state|features|app`
  - `src/state/**` cannot import `@/features|app`
  Verified with a throwaway probe import before finalizing.
- App shell (`src/app/App.tsx`): header with title + inert right-side slot, `<main>` empty
  state ("No rankings loaded yet." / "Rankings arrive in Phase 1."), single `<h1>`, landmark
  elements. One RTL test asserting the heading and empty-state text render.
- `PROJECT.md` §7 updated with the real, verified command list.

## Key dependency versions

| Package | Version |
|---|---|
| react / react-dom | ^19.2.8 |
| vite | ^7.3.6 |
| @vitejs/plugin-react | ^5.2.0 |
| typescript | ~5.9 (5.9.3) |
| tailwindcss / @tailwindcss/vite | ^4.3.3 |
| vitest | ^3.2.7 |
| eslint | ^9.39.5 |
| typescript-eslint | ^8.67.0 |

Full list in `package.json`.

## Deviations from the task spec

- `typescript@latest` and `vite@latest` resolved to majors ahead of spec (TS 7 beta, Vite 8)
  at install time; pinned explicitly to `typescript@~5.9` and `vite@^7` instead, and to a
  compatible `@vitejs/plugin-react@^5` (the `^6` line requires Vite 8).
- `@eslint/js@latest` resolved to `^10`, which requires ESLint 10; pinned to `^9` to match
  `eslint@^9` per spec.
- Skipped `@vitest/coverage-v8` — not required by the done-when criteria and the task listed
  it as optional.
- Added `@types/node` (not explicitly listed) — required for `vite.config.ts`'s
  `node:url` import to typecheck under `tsconfig.node.json`.
- Added `types: ["vite/client", "vitest/globals", "@testing-library/jest-dom"]` to
  `tsconfig.app.json` and `types: ["node"]` to `tsconfig.node.json` — needed for the CSS
  module import, Vitest globals, and `node:url` to resolve under `strict`/`isolatedModules`.

## Defects found and fixed during verification

Two issues were caught reviewing the generated output and were fixed before sign-off.

**1. The design-token type scale was inert.** `tokens.css` declared `--font-size-*`,
`--line-height-*`, and `--font-family-sans`. Those are not Tailwind v4 theme namespaces, so
they generated no utilities: the built CSS showed `.text-xl{font-size:var(--text-xl)}`
resolving to Tailwind's default `1.25rem` rather than the declared `1.5rem`. The tokens
existed but nothing read them — exactly the "defined once" guarantee that item 0.2 asks for,
silently not holding.

Fixed by using the real v4 namespaces: `--text-<n>` with a paired `--text-<n>--line-height`,
and `--font-sans`. The built CSS now emits `--text-xl:1.5rem` and
`--text-xl--line-height:2rem`. The colour (`--color-*`), spacing (`--spacing-*`), and radius
(`--radius-*`) namespaces were already correct — confirmed by probing that `p-md` and
`rounded-md` compile to `var(--spacing-md)` and `var(--radius-md)`.

**2. `npm run format` would have reflowed the spec documents.** `prettier --write .` covered
`PROJECT.md`, `CLAUDE.md`, and the `docs/` markdown, whose tables are hand-aligned. Added a
`.prettierignore` excluding `*.md` (plus `dist/`, `coverage/`, `package-lock.json`).
`npx prettier --check .` is now clean.

## Deliberately left out (later phases)

- No domain types, dataset files, or `RankingSource` adapter (Phase 1).
- No Zustand store, persistence, or undo (Phase 2 / 3.1).
- No drag-and-drop, filtering, search, or format switcher logic (Phase 2).
- No dark-mode toggle, motion, tier bands, density, virtualisation, or export/import
  (Phase 3) — dark-mode tokens are reserved in `tokens.css` but commented out.

## Structural note

This report lives in `docs/summary-reports/`, a directory that already existed in the repo
but is not listed in `PROJECT.md` §5's tree. §5 has been updated to include it so the
documented layout matches reality.
