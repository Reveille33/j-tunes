# j-Tunes

[![CI](https://github.com/Reveille33/j-tunes/actions/workflows/ci.yml/badge.svg)](https://github.com/Reveille33/j-tunes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A streamlined, highly performant desktop podcast manager and player, built as an
iTunes replacement for a large legacy podcast library dating back to 2011.

Built with **Electron 45**, **React 19**, **TypeScript** and **SQLite**
(`better-sqlite3`).

> The full design — architecture, schema and rationale — is in
> [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md).

---

## Features

| Area | What it does |
|---|---|
| **Subscriptions** | Subscribe by RSS URL or search the built-in directory. Robust RSS 2.0 + Atom parsing including `itunes:*` metadata. |
| **Updates** | Checks for new episodes automatically on startup, plus a manual **Check for Updates** button with live progress. |
| **Downloads** | Auto-downloads new episodes by default. Pause, delete and redownload, all from the episode row. |
| **Legacy import** | Imports an existing on-disk library (MP3/M4A/WAV) into the database, matching files to known episodes where possible. |
| **Search** | Instant search across titles, descriptions **and local filenames**, backed by a SQLite FTS5 index. |
| **Filter / sort** | By keyword, year, description text, title, release date, duration, podcast and played state. |
| **Player** | MP3 / M4A / WAV, 1.2x / 1.5x / 2x speed, ±30 s skip, and remembers the last playback position. |
| **Streaming** | Play an episode straight from its feed URL — no download needed first. |
| **Continue Listening** | A strip of in-progress episodes with artwork and progress, one click to resume. |
| **Storage** | See disk usage per podcast, and delete individual downloads, a selection, or a whole podcast's files (with a confirmation). |
| **Resume** | Paused or interrupted downloads continue from the partial file instead of restarting. |
| **OPML import & export** | Move your subscription list to and from any other podcast app (Settings → Subscriptions, or the command palette). |
| **Keyboard** | Ctrl/Cmd+K command palette, `?` for help, and ↑/↓ roving focus across episode rows. |
| **Up Next** | Persistent play queue with continuous playback — finishing an episode rolls straight into the next. |
| **Chapters** | Podcast 2.0 chapter markers, fetched on demand, with click-to-seek from the player. |
| **Sleep timer** | Auto-pause after 15 / 30 / 45 / 60 minutes. |
| **Podcast view** | Artwork, author, episode count, per-podcast auto-download, "mark all played" and unsubscribe. |
| **Bulk actions** | Tick episodes to mark played/unplayed or add to Up Next in one action. |
| **Stats** | Listening time, day streak, most-listened podcasts and a 14-day activity chart. |
| **Notifications** | Optional OS notification when a check finds new episodes. |
| **Descriptions** | Brief by default, with a global show/hide toggle and per-episode click-to-expand. |
| **Themes** | Dark and Light, persisted across restarts. |

## Quick start

```bash
npm install          # no native compilation required - see "Native modules" below
npm run dev          # start the app with hot reload
npm test             # run the test suite
npm run typecheck    # type-check the main and renderer projects
npm run build        # bundle into out/
npm run package      # build installers into release/
```

### Native modules

`better-sqlite3` v13 is built against **N-API v10**, which is ABI-stable across
Node and Electron versions. It ships prebuilt binaries for every supported
platform, so **no C++ toolchain and no `electron-rebuild` step is needed**. The
`postinstall` script is intentionally absent.

## Architecture

```
src/
├─ shared/      types, IPC contract, zod validation, constants
├─ main/        Electron main process
│  ├─ db/       connection, migrations, repositories
│  ├─ services/ feed parsing, updates, downloads, import
│  ├─ ipc/      one handler module per domain
│  └─ util/     paths, filesystem helpers
├─ preload/     the contextBridge API (window.api)
└─ renderer/    React UI
```

Security posture: `contextIsolation` on, `nodeIntegration` off, `sandbox` on, a
strict Content Security Policy, and all filesystem and network access confined
to the main process. The renderer only ever receives typed, zod-validated data
through `window.api`.

### Why these choices

- **SQLite via `better-sqlite3`** — synchronous C++ SQLite gives the fastest
  possible local reads and includes FTS5, so searching a 50,000-episode library
  stays instant without a separate search index.
- **FTS5 external-content table** — full-text search over title, description and
  filename without duplicating the text, kept in sync by triggers.
- **`UNIQUE (podcast_id, guid)`** — makes re-checking a feed idempotent: only
  genuinely new episodes are ever inserted.
- **Conditional GET (`ETag` / `Last-Modified`)** — a feed that has not changed
  costs one HTTP request and no parsing at all.
- **`@tanstack/react-virtual`** — only the visible rows exist in the DOM, so a
  library of tens of thousands of episodes scrolls smoothly.

## Data

The database lives in the app's user-data directory:

| Platform | Path |
|---|---|
| Windows | `%APPDATA%\j-tunes\jtunes.db` |
| macOS | `~/Library/Application Support/j-tunes/jtunes.db` |
| Linux | `~/.config/j-tunes/jtunes.db` |

Downloads go to `<userData>\downloads\<Podcast Title>\` by default.

To reset the app, close it and delete that folder.

## Tests

```bash
npm test
```

The suite covers the database layer (schema, indexes, cascade deletes,
pagination, FTS5), the feed parser (RSS 2.0, Atom, CDATA, namespaces,
malformed input), the legacy importer's matching logic, stylesheet integrity,
and a performance test that seeds **50,000 episodes** and asserts that search,
filter and sort all stay well under a frame budget.

## Licence

MIT
