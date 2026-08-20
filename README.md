# Fantasy Assist

A single-user, browser-based fantasy football **draft board** — the thing you keep open on a
second monitor while a draft is running. A ranked list of players you have personally tuned,
filtered to the position you care about, with drafted players crossed off in one click.

No login, no server, no setup. Everything is stored in your own browser.

- **What it is and how it's built:** [`PROJECT.md`](./PROJECT.md)
- **What shipped, phase by phase:** [`docs/summary-reports/`](./docs/summary-reports/)

---

## Requirements

| | |
|---|---|
| **Node** | 22 or newer. Node 22.5+ ships `node:sqlite`, which the test suite uses as a real SQL engine. |
| **Browser** | Chrome 108+, Firefox 111+, or Safari 16.4+ — the board is stored in SQLite on the browser's OPFS (Origin Private File System), which older versions don't support. |

**Not private/incognito browsing.** Private windows commonly block OPFS. The app will tell you so
with an error panel rather than silently running without saving anything — see
[Troubleshooting](#troubleshooting).

## Running it

```bash
npm install
npm run dev
```

Then open **http://localhost:5173/**. That's the whole setup.

The dev server hot-reloads on save. Stop it with `Ctrl+C`.

### Production build

```bash
npm run build     # type-checks, then writes static files to dist/
npm run preview   # serves dist/ locally so you can check the real build
```

`dist/` is plain static files — deploy it to Vercel, Netlify, GitHub Pages, or anything else that
serves a directory. No server runtime and no response-header configuration is required.

## All commands

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server on http://localhost:5173 |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run test` | Vitest, single pass |
| `npm run test:watch` | Vitest in watch mode |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint — expected to be zero errors *and* zero warnings |
| `npm run format` | Prettier, writing in place |
| `npm run fetch:rankings` | Regenerate the ranking datasets from Flock Fantasy's public API |

`fetch:rankings` is the **only** command that touches the network, and it is a build-time tool —
the app itself makes no network calls at runtime. Refreshing rankings means running it and
committing the diff; see [`PROJECT.md` §3](./PROJECT.md).

## Where your board is stored

In a **SQLite database inside your browser**, on the origin you loaded the app from
(`localhost:5173` in development). It is per-browser and per-origin: boards created on
`localhost` will not appear on a deployed copy, and vice versa.

That storage is not visible in your file system and can be wiped by clearing site data, so:

> **Use Export.** The Export button downloads the whole database as a `.sqlite` file — every
> board, note, watchlist star and custom tier. It is the only way to back your board up or move it
> to another browser, and you can open it in any desktop SQLite client to inspect it.

Import accepts that `.sqlite` file, and also still accepts the older `.json` backups from before
the database existed.

## Troubleshooting

**"Fantasy Assist couldn't load" (a red panel instead of the board).**
The browser refused to open its local database. Almost always one of:

- a private/incognito window — try a normal one;
- a browser older than the versions listed above;
- site data blocked for this origin in your browser settings.

Your board is not lost. If you had one before the database existed, it is still in this browser's
`localStorage` and the app will migrate it as soon as it can start.

**"Your last change could not be saved" (a banner above the board).**
A write to the database was rejected. What you see on screen is still correct — the change is in
memory, it just didn't reach storage. Export is disabled while this banner is up, deliberately: a
backup taken now could be missing exactly that change.

**Don't reload yet** — reloading reads the board back from the database, which will discard the
change that failed to save. Check the browser's storage quota first, then redo the change so it
gets another chance to write.

**A banner saying players were added or removed.**
The bundled rankings changed since you last opened the app (someone ran `fetch:rankings`). Your
ordering is preserved; new players are inserted at their published rank. Note that removed players
take their notes, stars and tier breaks with them — that's what the banner is warning you about.
