# j-Tunes — Implementation Plan

> Desktop podcast manager & player (iTunes replacement) for a large legacy library (2011 → today).
> Status: **Awaiting approval.** No project files are scaffolded until this plan is approved.

---

## 1. Goals & Non-Goals

### Goals
1. Manage **tens of thousands** of episodes without UI jank (virtualized list, indexed SQL, FTS5 search).
2. Subscribe by RSS URL or via built-in feed search; robust RSS 2.0 + Atom parsing (incl. `itunes:*` namespaces).
3. Automatic episode discovery on app startup + manual **Check for Updates**.
4. Download management: auto-download by default, with pause / delete / redownload.
5. Local import of a legacy on-disk podcast library into SQLite.
6. Instant search across filenames + metadata; filter and sort by keyword, year, description text, title, release date.
7. Built-in player: MP3 / M4A / WAV, speed 1.2x / 1.5x / 2x, +/-30s skip, resume from last position.
8. Description UI: brief by default, global show/hide toggle, per-episode click-to-expand.
9. Dark and Light themes, persisted.

### Non-Goals (v1)
- No mobile/streaming-server client, no multi-device sync, no podcast discovery beyond a search provider.
- No DRM, no video playback. No account system / cloud storage.

---

## 2. Technology Stack & Version Pins

| Layer | Choice | Version | Rationale |
|---|---|---|---|
| Shell | Electron | `45.3.2` | Current stable; Node 24 runtime, modern Chromium. |
| Bundler | electron-vite | `6.0.0` | Vite-powered main/preload/renderer builds, HMR, tiny config. |
| Renderer | React + TypeScript | `19.3.1` | Concurrent rendering keeps big lists smooth. |
| Database | better-sqlite3 | `13.2.0` | **Synchronous** C++ SQLite: fastest local reads, FTS5 included, no per-query IPC. |
| XML parsing | fast-xml-parser | `5.12.1` | Far faster than `rss-parser`, full namespace control, no regex hacks. |
| Tag reading | music-metadata | `12.5.0` | Pure JS ID3/MP4/WAV tag + duration extraction for the importer. |
| List virtualizing | @tanstack/react-virtual | `3.14.26` | Renders only visible rows - mandatory for 50k+ episodes. |
| Client state | zustand | `5.1.0` | Tiny, no context churn, ideal for IPC-fed stores. |
| Validation | zod | `4.6.7` | Runtime validation of every IPC payload in both directions. |
| Packaging | electron-builder | `26.18.0` | Windows/macOS/Linux installers. |
| Tests | vitest | `5.1.0` | Unit tests for parser, DB layer, sort/filter logic. |

**Why not `node:sqlite`?** Node's built-in SQLite is still experimental and Electron does not guarantee the module is exposed in the main process. `better-sqlite3` is battle-tested with Electron and needs only `electron-rebuild` (wired into `postinstall`).

**Why no ORM?** Hand-written prepared statements against one indexed schema are far faster and keep the search/sort SQL transparent and tunable.

---

## 3. Folder Structure

```
j-tunes/
├─ package.json
├─ electron.vite.config.ts          # main / preload / renderer build targets
├─ electron-builder.yml             # installer + artifact config
├─ tsconfig.json  tsconfig.node.json  tsconfig.web.json
├─ vitest.config.ts
├─ .gitignore  .editorconfig  .npmrc
├─ README.md
├─ docs/
│  └─ IMPLEMENTATION_PLAN.md        # this artifact
├─ resources/
│  ├─ icon.ico  icon.icns  icon.png
│  └─ tray/                         # tray icon (optional, v1.1)
└─ src/
   ├─ shared/                       # code imported by BOTH processes
   │  ├─ types.ts                   # Podcast, Episode, PlayerState, DTOs
   │  ├─ ipc.ts                     # channel name constants + payload contracts
   │  ├─ validation.ts              # zod schemas shared by preload & renderer
   │  └─ constants.ts               # sort modes, filters, speed presets, defaults
   │
   ├─ main/                         # -- Electron MAIN process (Node) --
   │  ├─ index.ts                   # app lifecycle, window creation, single-instance lock
   │  ├─ window.ts                  # BrowserWindow factory + security hardening
   │  ├─ ipc/
   │  │  ├─ index.ts                # registers every handler, one file per domain
   │  │  ├─ podcasts.ipc.ts         # subscribe/unsubscribe/list/feed-search
   │  │  ├─ episodes.ipc.ts         # list/search/filter/sort, mark played
   │  │  ├─ updates.ipc.ts          # checkForUpdates (manual + startup)
   │  │  ├─ downloads.ipc.ts        # queue/pause/resume/delete/redownload
   │  │  ├─ library.ipc.ts          # legacy import + folder picking
   │  │  ├─ player.ipc.ts           # position save/restore
   │  │  └─ settings.ipc.ts         # theme, download dir, auto-download flag
   │  ├─ db/
   │  │  ├─ connection.ts           # open DB, PRAGMAs, WAL, foreign_keys
   │  │  ├─ migrations.ts           # versioned, transactional migration runner
   │  │  ├─ migrations/
   │  │  │  └─ 001_initial.sql      # schema (canonical source of truth)
   │  │  └─ repositories/
   │  │     ├─ podcastRepo.ts
   │  │     ├─ episodeRepo.ts
   │  │     ├─ settingsRepo.ts
   │  │     └─ searchRepo.ts        # FTS5 + filter + sort queries
   │  ├─ services/
   │  │  ├─ feedParser.ts           # XML -> normalized Feed object
   │  │  ├─ feedService.ts          # fetch, conditional GET (ETag/Last-Modified), upsert
   │  │  ├─ feedSearchService.ts    # iTunes-style directory search
   │  │  ├─ updateService.ts        # startup sweep + manual check + progress events
   │  │  ├─ downloadManager.ts      # queue, concurrency limit, pause/resume/cancel
   │  │  ├─ downloader.ts           # streamed HTTP -> .part file -> atomic rename
   │  │  ├─ importer.ts             # legacy scan, tag match, DB insert
   │  │  ├─ metadataReader.ts       # music-metadata wrapper
   │  │  └─ libraryService.ts       # query orchestration (search/filter/sort)
   │  ├─ util/
   │  │  ├─ paths.ts                # appData / downloads / db locations
   │  │  ├─ logger.ts               # ring-buffer file logger
   │  │  ├─ fsHelpers.ts            # safe rename/delete, unique filenames
   │  │  ├─ sanitize.ts             # filename sanitisation, HTML strip
   │  │  └─ time.ts                 # date normalisation
   │  └─ store/
   │     └─ settingsStore.ts        # persisted app settings
   │
   ├─ preload/
   │  ├─ index.ts                   # contextBridge -> window.api
   │  └─ api.d.ts                   # typed surface for the renderer
   │
   └─ renderer/                     # -- React RENDERER (Chromium) --
      ├─ index.html
      ├─ main.tsx
      ├─ App.tsx
      ├─ components/
      │  ├─ layout/   AppShell.tsx  TitleBar.tsx  Sidebar.tsx  StatusBar.tsx
      │  ├─ episodes/ EpisodeList.tsx  EpisodeRow.tsx  EpisodeVirtualList.tsx
      │  │            DescriptionCell.tsx  EpisodeActions.tsx  FilterPanel.tsx
      │  ├─ player/   PlayerBar.tsx  PlaybackControls.tsx  SpeedMenu.tsx  VolumeSlider.tsx
      │  ├─ podcasts/ AddPodcastDialog.tsx  FeedSearchResults.tsx  PodcastList.tsx
      │  │            PodcastCard.tsx  ImportWizard.tsx
      │  ├─ common/   Button.tsx  Icon.tsx  Dialog.tsx  Tooltip.tsx
      │  │            Spinner.tsx  Toast.tsx  VirtualList.tsx
      │  └─ search/   SearchBar.tsx  SearchSuggestions.tsx
      ├─ hooks/
      │  ├─ useEpisodes.ts  usePodcasts.ts  usePlayer.ts  useTheme.ts
      │  ├─ useKeyboardShortcuts.ts  useResizableSidebar.ts
      ├─ state/
      │  ├─ episodeStore.ts   podcastStore.ts   playerStore.ts   uiStore.ts
      ├─ styles/
      │  ├─ theme.css         # CSS custom properties: light + dark
      │  ├─ globals.css       # resets, layout primitives
      │  └─ components.css
      └─ utils/  format.ts  time.ts  classNames.ts
```

### Architectural rules
- **Context isolation on**, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`. The renderer never touches `fs`, `net`, or the DB directly.
- All main<->renderer traffic goes through the typed `window.api` preload bridge (`ipcRenderer.invoke` / `send` / `on`).
- Renderer audio playback uses a plain `<audio>` element with a `file://` URL issued by the main process for a given episode id (the renderer never guesses paths).
- `shared/` is the single source of truth for types; `zod` schemas validate on both ends.

---

## 4. SQLite Schema

Design goals: a library of **50k-200k episodes** with sub-100 ms search, lossless re-sync of feeds, and cheap incremental import. All timestamps are **Unix epoch milliseconds (INTEGER)** - sortable, timezone-safe, trivially indexable.

### 4.1 `podcasts`

```sql
CREATE TABLE podcasts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url          TEXT    NOT NULL UNIQUE,   -- canonicalised feed URL (dedup key)
  title             TEXT    NOT NULL,
  author            TEXT,
  description       TEXT,
  description_html  TEXT,                      -- original HTML kept for future use
  artwork_url       TEXT,
  category          TEXT,
  language          TEXT,
  link              TEXT,
  etag              TEXT,                      -- for conditional GET
  last_modified     TEXT,                      -- for conditional GET
  last_checked_at   INTEGER,                   -- epoch ms of last update attempt
  last_episode_at   INTEGER,                   -- max release date, for sort/display
  episode_count     INTEGER NOT NULL DEFAULT 0,
  subscribed_at     INTEGER NOT NULL,
  auto_download     INTEGER NOT NULL DEFAULT 1,-- per-podcast override of global default
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_podcasts_last_episode ON podcasts(is_active, last_episode_at DESC);
CREATE INDEX idx_podcasts_title        ON podcasts(title COLLATE NOCASE);
```

### 4.2 `episodes`

```sql
CREATE TABLE episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id      INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  guid            TEXT    NOT NULL,            -- stable item id from the feed
  title           TEXT    NOT NULL,
  description     TEXT,                        -- stripped plain text
  description_html TEXT,                       -- original markup (rendered on expand)
  media_url       TEXT,                        -- enclosure url
  media_type      TEXT,                        -- audio/mpeg, audio/x-m4a, audio/wav
  media_length    INTEGER,                     -- bytes, from enclosure length attr
  duration_secs   INTEGER,                     -- normalised seconds (parsed or measured)
  release_date    INTEGER,                     -- epoch ms, normalised
  episode_number  INTEGER,
  season_number   INTEGER,
  artwork_url     TEXT,
  file_path       TEXT,                        -- absolute local path once downloaded
  file_size       INTEGER,
  download_state  TEXT    NOT NULL DEFAULT 'none',
                                            -- none|queued|downloading|paused|done|error
  download_error  TEXT,
  played          INTEGER NOT NULL DEFAULT 0,  -- 0/1
  play_position   REAL    NOT NULL DEFAULT 0,  -- seconds, for resume
  duration_known  REAL,                        -- measured duration after import/scan
  is_imported     INTEGER NOT NULL DEFAULT 0,  -- 1 = came from legacy local import
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (podcast_id, guid)
);
CREATE INDEX idx_episodes_podcast_date ON episodes(podcast_id, release_date DESC);
CREATE INDEX idx_episodes_release_date  ON episodes(release_date DESC);
CREATE INDEX idx_episodes_download      ON episodes(download_state);
CREATE INDEX idx_episodes_played        ON episodes(played);
CREATE INDEX idx_episodes_file_path     ON episodes(file_path);
CREATE INDEX idx_episodes_title         ON episodes(title COLLATE NOCASE);
```

### 4.3 `episode_search` (FTS5)

Plain `LIKE '%term%'` scans the whole table and cannot use indexes. FTS5 gives instant keyword search over title, description and filename, with prefix matching and ranking.

```sql
CREATE VIRTUAL TABLE episode_search USING fts5(
  title,
  description,
  file_path,
  content = 'episodes',          -- external-content table: no duplicate storage
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);
-- Keep FTS in sync with the base table
CREATE TRIGGER episodes_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episode_search(rowid, title, description, file_path)
  VALUES (new.id, new.title, new.description, new.file_path);
END;
CREATE TRIGGER episodes_ad AFTER DELETE ON episodes BEGIN
  INSERT INTO episode_search(episode_search, rowid, title, description, file_path)
  VALUES ('delete', old.id, old.title, old.description, old.file_path);
END;
CREATE TRIGGER episodes_au AFTER UPDATE ON episodes BEGIN
  INSERT INTO episode_search(episode_search, rowid, title, description, file_path)
  VALUES ('delete', old.id, old.title, old.description, old.file_path);
  INSERT INTO episode_search(rowid, title, description, file_path)
  VALUES (new.id, new.title, new.description, new.file_path);
END;
```

> External-content (`content='episodes'`) mode stores only the index, not a second copy of the text. Rebuild with `INSERT INTO episode_search(episode_search) VALUES('rebuild')` after any bulk import.

### 4.4 `settings` (key/value)

```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

Keys: `theme` (`dark`|`light`), `download_dir`, `auto_download_default`, `global_descriptions_visible`, `last_playback_speed`, `default_volume`, `window_bounds`, `check_updates_on_startup`.

### 4.5 `download_queue` (durable, survives restart)

```sql
CREATE TABLE download_queue (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id  INTEGER NOT NULL UNIQUE REFERENCES episodes(id) ON DELETE CASCADE,
  state       TEXT    NOT NULL DEFAULT 'queued',  -- queued|downloading|paused|error|done
  progress    REAL    NOT NULL DEFAULT 0,        -- 0..1
  bytes_done  INTEGER NOT NULL DEFAULT 0,
  total_bytes INTEGER,
  error       TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  queued_at   INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_dlq_state ON download_queue(state, queued_at);
```

The queue lives in SQLite (not just memory) so a crash or restart resumes interrupted downloads instead of losing them.

### 4.6 `import_jobs` (legacy import audit trail)

```sql
CREATE TABLE import_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_dir  TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  files_seen  INTEGER NOT NULL DEFAULT 0,
  files_matched  INTEGER NOT NULL DEFAULT 0,
  files_added   INTEGER NOT NULL DEFAULT 0,
  files_skipped INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'running'   -- running|completed|failed|cancelled
);
```

### 4.7 Indexing & performance notes

| Query | Mechanism | Expected cost at 100k episodes |
|---|---|---|
| List a podcast's episodes | `idx_episodes_podcast_date` | index seek + row fetch, ~ms |
| Global newest-first | `idx_episodes_release_date` | index seek, ~ms |
| Keyword search | FTS5 `MATCH` + `bm25()` rank | ~5-20 ms |
| Filter by year | epoch-ms range on a date-indexed column | limited range scan |
| Filter by podcast | `idx_episodes_podcast_date` | index seek |
| Played / downloaded filters | `idx_episodes_played`, `idx_episodes_download` | index seek |
| Import dedupe | `idx_episodes_file_path` | index lookup |

PRAGMAs applied at open time:

```sql
PRAGMA journal_mode = WAL;          -- concurrent read while writing
PRAGMA synchronous = NORMAL;        -- safe with WAL, ~5x faster than FULL
PRAGMA foreign_keys = ON;           -- enforce podcast_id cascade
PRAGMA cache_size = -64000;         -- 64 MB page cache
PRAGMA temp_store = MEMORY;
PRAGMA mmap_size = 268435456;       -- 256 MB memory-mapped I/O
```

### 4.8 Year filtering

Years are derived from `release_date` rather than stored, to avoid a denormalised column drifting out of sync. The query uses a precomputed range so the date index still applies:

```sql
AND release_date >= :yearStart AND release_date < :yearEnd
```

where `:yearStart`/`:yearEnd` are epoch-ms bounds computed in JS for the selected year in **local** time.

### 4.9 Query shape (search + filter + sort)

A single composable SQL builder in `searchRepo.ts` keeps the where-clause assembly in one place:

```sql
SELECT e.*, p.title AS podcast_title,
       bm25(episode_search) AS rank
FROM episode_search s
JOIN episodes e ON e.id = s.rowid
JOIN podcasts p ON p.id = e.podcast_id
WHERE episode_search MATCH :q            -- only when a search term is present
  AND (:podcastId IS NULL OR e.podcast_id = :podcastId)
  AND (:year      IS NULL OR (e.release_date >= :yearStart AND e.release_date < :yearEnd))
  AND (:played    IS NULL OR e.played = :played)
  AND (:downloadState IS NULL OR e.download_state = :downloadState)
  AND (:descriptionTerm IS NULL OR e.description LIKE :descriptionTerm)
ORDER BY
  CASE WHEN :sortBy = 'title'        THEN e.title END COLLATE NOCASE ASC,
  CASE WHEN :sortBy = 'release_date' THEN e.release_date END DESC,
  CASE WHEN :sortBy = 'duration'     THEN e.duration_secs END DESC,
  CASE WHEN :sortBy = 'podcast'      THEN p.title END COLLATE NOCASE ASC,
  CASE WHEN :sortBy = 'relevance'    THEN rank END ASC
LIMIT :limit OFFSET :offset;
```

- `:sortBy` is validated against an allow-list, so it can never be interpolated from user input.
- `descriptionTerm` uses `LIKE` with an escaped pattern for "description contains" filtering (an explicit, targeted filter rather than free-text search).
- The renderer always requests a bounded page (`LIMIT 200`) and paginates incrementally, so the DOM never holds more than the visible window.

---

## 5. RSS Parsing (robustness)

`feedParser.ts` uses `fast-xml-parser` with `ignoreAttributes: false`, `attributeNamePrefix: '@_'` and `removeNSPrefix: false` so `itunes:*` tags stay addressable.

Handles:
- **RSS 2.0** (`rss > channel > item`) and **Atom** (`feed > entry`), auto-detected by root element.
- `enclosure` (url, type, length) and Atom `link rel="enclosure"`.
- `itunes:duration` in `HH:MM:SS`, `MM:SS`, or plain seconds.
- `itunes:image` / `itunes:episodeType` / `itunes:season` / `itunes:episode` / `itunes:explicit`.
- `content:encoded` and `media:content` fallbacks for description and media URL.
- CDATA (handled natively by fast-xml-parser) and entity decoding.
- Date parsing: RFC 822 (`Tue, 05 Nov 2019 12:00:00 GMT`) and ISO 8601 -> epoch ms. Unparseable dates fall back to "now" but are flagged.
- GUID collisions across podcasts are fine (the unique key is `(podcast_id, guid)`); a missing GUID falls back to a hash of `media_url + title`.

Description handling: both `description` (plain text, stripped) and `description_html` (original) are stored. The plain text drives search; the HTML drives the expanded view.

**Failure handling**: a feed that fails to fetch or parse updates `last_checked_at`, records the error, and never deletes existing episodes. Existing episodes are only ever removed by an explicit user action.

## 6. Updates (startup + manual)

`updateService.ts`:
1. On startup (after the window is shown, so the UI is already interactive), iterate all `is_active = 1` podcasts.
2. Use **conditional GET** with the stored `etag` / `last_modified` headers - a 304 response skips parsing entirely. This is what makes the check cheap across a large library.
3. Concurrency limited to **4 feeds at a time** with a per-request timeout of 20 s, so a dead feed cannot stall the sweep.
4. New episodes are inserted inside a transaction; `podcast.episode_count` and `last_episode_at` are recomputed.
5. **Auto-download**: if the podcast's `auto_download` (or the global default) is on, new episodes are enqueued in `download_queue`.
6. Progress is pushed to the renderer over an IPC event channel: `{ podcastId, title, found, added, status }`, so the UI can show a live "Checked 12 of 340 podcasts".
7. **Manual "Check for Updates"** button runs the same service on demand, with a progress indicator and a summary toast ("17 new episodes across 4 podcasts").

## 7. Download Management

`downloadManager.ts` + `downloader.ts`:

- **Concurrency**: 3 simultaneous downloads (tunable), queued rest persisted in `download_queue`.
- **Streaming**: `net.request`/`fetch` response body piped to a `*.part` file, then atomically renamed to the final name on completion. A `.part` file is never mistaken for a complete download.
- **Filename**: `<sanitised podcast title>/<sanitised episode title>.<ext>`, with collision suffixes (` (2)`).
- **Extensions**: determined from the URL path or `media_type`; only `mp3`, `m4a`, `wav` are accepted (configurable whitelist).
- **Pause**: the response stream is aborted and the partial file is kept; `state = 'paused'`, `bytes_done` recorded.
- **Resume**: uses HTTP `Range` when the server supports it (206), otherwise restarts the file.
- **Delete**: removes the file from disk and resets `download_state` to `none`, clearing `file_path` / `file_size`.
- **Redownload**: deletes the existing file, resets state to `queued`, re-enqueues. Available per-episode and per-podcast ("Download all episodes").
- **Progress**: throttled to ~4 events/sec/episode, forwarded to the renderer via `download:progress` IPC events.

## 8. Local Import (legacy library)

`importer.ts`:
1. The user picks a folder (Electron `dialog.showOpenDialog`) - or several.
2. Recursive scan for `*.mp3`, `*.m4a`, `*.wav` (case-insensitive).
3. For each file, read tags via `music-metadata`: title, artist, album, duration, year, and track number.
4. **Matching strategy**, in priority order:
   - a. Match by **filename** against an existing episode's `file_path` basename (exact).
   - b. Match by **normalised title** (case/punctuation-insensitive) within a podcast whose title matches the album/artist.
   - c. Match by **audio tag** (title + artist/album) against existing episodes.
   - d. Otherwise **create a new episode** under a synthesised podcast named after the folder/album, with `is_imported = 1`.
5. Progress is streamed to the renderer; the run is recorded in `import_jobs`.
6. Matching existing episodes **fills in** `file_path`, `file_size`, `duration_secs` and flips `download_state` to `done` - so imported files become fully playable and searchable immediately.
7. Duplicate files (same path already in the DB) are skipped via the `file_path` index.

---

## 9. UI / UX Design

### Layout

```
┌──────────────────────────────────────────────────────────────┐
│ TitleBar: [j-Tunes] [Search............] [Check Updates] ☀/☾ │
├────────────┬─────────────────────────────────────────────────┤
│ Sidebar    │ Toolbar: [All][Unplayed][Downloaded] | Year ▾ |  │
│  Subscribed│        Sort: Release date ▾ | Desc ▾ | Show desc │
│   • Show A │─────────────────────────────────────────────────│
│   • Show B │ Episode list (virtualised)                     │
│  Downloads │  ▸ Title            Podcast   Date    ⏱  ⋯      │
│  Imported  │    Brief description text...                    │
│            │─────────────────────────────────────────────────│
│            │ PlayerBar: ▶ ⟲30 ⟳30  ──────●────── 1.5x 🔊    │
└────────────┴─────────────────────────────────────────────────┘
```

### Search
- A single omnibox in the title bar searches **title, description and local filename** at once (this is the FTS5 table).
- Debounced at **120 ms**; the query runs in the main process via `episodes:query` and returns a page of rows.
- Typing in the search box also narrows the sidebar list of podcasts (shows a flat "Search results" view across all podcasts).
- Filters (sidebar + toolbar): podcast, year (derived from release dates), played/unplayed, downloaded/not, and a dedicated "description contains" text filter.

### Sort
Dropdown with: **Release date** (default, newest first), **Title**, **Duration**, **Podcast**, **Relevance** (only when searching), and a click-to-toggle ascending/descending.

### Description UI
- Default state: **brief** - a single truncated line (CSS `-webkit-line-clamp: 1`) of the plain-text description.
- **Global toggle** in the toolbar ("Show descriptions") persists in `settings.global_descriptions_visible` and applies instantly to all rows.
- **Per-episode expand**: clicking the description text toggles that episode between brief and full. The full view renders the sanitised `description_html` (HTML stripped/sanitised in the main process before it ever reaches the renderer, so no script injection is possible). Multiple episodes can be expanded at once; the set of expanded ids lives in the UI store.

### Theming
- CSS custom properties on `:root` with `[data-theme="dark"]` / `[data-theme="light"]` overrides.
- The theme attribute is set on `<html>` before React mounts to avoid a flash of the wrong theme; the choice is persisted in `settings.theme` and applied at startup by the main process.
- Colours cover: background, surface, surface-raised, border, text, text-muted, accent, accent-contrast, plus semantic success/warn/error, and a player-bar surface.
- A `prefers-color-scheme` fallback is used only for the very first paint when no stored preference exists.

### Player
- A single persistent `<audio>` element in the renderer, driven by `usePlayer` / `playerStore`.
- **Controls**: play/pause, **-30 s**, **+30 s**, speed menu (**1.2x / 1.5x / 2x** plus 1.0x), volume, seek bar, current/total time.
- **Speed**: `audio.playbackRate = rate`; the last used rate persists in `settings.last_playback_speed`.
- **Position memory**: `play_position` is written to SQLite every **5 s** during playback and on pause/stop/episode-change/window-close, and restored when the episode is opened. Resume is automatic if the stored position is more than 10 s in and less than 15 s from the end.
- Supported formats: **MP3, M4A, WAV** - the renderer checks the extension before assigning the `src`, and the main process only ever hands out a path for a file that exists on disk.
- Keyboard shortcuts: `Space` play/pause, `←`/`→` skip 30 s, `↑`/`↓` volume, `,`/`.` speed.

## 10. IPC Contract (summary)

All channels are declared as constants in `src/shared/ipc.ts` and validated with zod.

| Channel | Direction | Payload | Result |
|---|---|---|---|
| `podcasts:list` | invoke | `{ includeInactive? }` | `Podcast[]` |
| `podcast:subscribe` | invoke | `{ feedUrl }` | `Podcast` |
| `podcast:unsubscribe` | invoke | `{ podcastId }` | `void` |
| `podcast:searchFeed` | invoke | `{ query, limit }` | `FeedSearchResult[]` |
| `episodes:query` | invoke | `{ q, filters, sort, limit, offset }` | `{ rows, total }` |
| `episodes:setPlayed` | invoke | `{ episodeId, played }` | `void` |
| `episode:mediaUrl` | invoke | `{ episodeId }` | `{ url, mime, duration }` |
| `updates:check` | invoke | `{ podcastId? }` | `void` (progress via events) |
| `updates:progress` | event | `{ podcastId, title, done, total, found, added }` | - |
| `downloads:enqueue` / `pause` / `resume` / `delete` / `redownload` | invoke | `{ episodeId \| podcastId }` | `void` |
| `downloads:progress` | event | `{ episodeId, progress, bytesDone, totalBytes, state }` | - |
| `downloads:list` | invoke | `{}` | `DownloadQueueItem[]` |
| `library:import` | invoke | `{ paths }` | `void` (progress via events) |
| `library:pickFolder` | invoke | `{}` | `string[]` |
| `player:savePosition` | invoke | `{ episodeId, position, duration }` | `void` |
| `settings:get` / `settings:set` | invoke | `{ key, value }` | `value` |
| `app:theme` | invoke | `{ theme }` | `void` |

## 11. Build & Execution Steps (post-approval)

1. `npm init -y`, install runtime + dev dependencies, then `npx electron-builder install-app-deps` so `better-sqlite3` is rebuilt against Electron's ABI.
2. Write `electron.vite.config.ts`, the three tsconfigs, `electron-builder.yml`, `.gitignore`, `.editorconfig`.
3. Create the full `src/` tree per section 3 (empty-but-typed modules first).
4. Implement `src/main/db` (connection, migrations, schema SQL, repositories).
5. Implement `src/main/services` (parser, feed service, update service, downloader, importer, library service).
6. Implement `src/main/ipc` + `src/preload`.
7. Implement the renderer: shell, sidebar, virtualised list, toolbar/filters, player, theming.
8. Implement the legacy import wizard and the feed search dialog.
9. Write vitest unit tests for the parser, the search/filter/sort SQL, and the importer matching logic.
10. `npm run dev` to smoke-test; `npm run build` + `npm run package` for installers.

### Scripts

```json
{
  "dev": "electron-vite dev",
  "build": "electron-vite build",
  "preview": "electron-vite preview",
  "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.web.json",
  "test": "vitest run",
  "package": "npm run build && electron-builder",
  "postinstall": "electron-builder install-app-deps"
}
```

## 12. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `better-sqlite3` native ABI mismatch with Electron | `postinstall: electron-builder install-app-deps`; pinned version. |
| Some feeds are huge / malformed | fast-xml-parser with per-feed try/catch; a bad feed never aborts the sweep. |
| Huge legacy import blocking the UI | Import runs in the main process asynchronously with batched inserts (500 rows/transaction) and progress events; the renderer stays responsive. |
| 50k+ rows killing React | `@tanstack/react-virtual` renders ~30 rows; pagination of 200 keeps IPC payloads small. |
| Servers rejecting Range requests | Fall back to a full restart on non-206 responses. |
| Slow/failed feeds at startup | Conditional GET, 4-way concurrency, 20 s timeout; startup check runs after first paint. |
| Playback of a deleted file | `episode:mediaUrl` re-checks existence and returns an error the player surfaces. |

## 13. Definition of Done

- [ ] Subscribe via URL and via built-in search; unsubscribe works and cleans up episodes.
- [ ] Feeds parsed for RSS 2.0 and Atom, including `itunes:*` metadata.
- [ ] Startup auto-check finds and stores new episodes; manual **Check for Updates** works with live progress.
- [ ] Auto-download on by default; pause, delete and redownload all work from the UI.
- [ ] Legacy import matches existing episodes and adds unmatched ones as importable entries.
- [ ] Search covers filename + title + description, and returns results instantly on a 50k-episode library.
- [ ] Filter by year, podcast, played, downloaded, description text; sort by release date, title, duration, podcast.
- [ ] Player plays MP3/M4A/WAV, supports 1.2x/1.5x/2x, ±30 s, and resumes from the last position.
- [ ] Descriptions are brief by default, with a global toggle and per-episode expand.
- [ ] Dark and Light themes both render correctly and persist across restarts.
- [ ] `npm run typecheck` and `npm run test` pass; the packaged app launches on Windows.

---

## 14. Open Questions (defaults assumed if you don't object)

1. **Download location** - default to `<userData>/downloads/<Podcast Title>/`, configurable in Settings.
2. **Feed search provider** - default to the public iTunes Search API (`https://itunes.apple.com/search?media=podcast`); can be swapped for a self-hosted index later.
3. **Data retention** - *resolved:* unsubscribing presents a choice - **keep** the downloaded files on disk, or **move them to the OS recycle bin** (Electron `shell.trashItem`). The database rows are always removed. See section 15.
4. **Legacy import** - assume the legacy library is a flat folder of MP3/M4A/WAV files, possibly nested by show name; the importer handles both.

---

## 15. Unsubscribe: Keep or Trash

Unsubscribing always removes the podcast row and cascades to its episode rows (SQLite `ON DELETE CASCADE`). The only question is what happens to the **audio files already on disk**, so the user chooses explicitly.

### Behaviour

`podcast:unsubscribe` accepts `{ podcastId, fileAction: 'trash' | 'keep' }`.

| `fileAction` | Database rows | Files on disk |
|---|---|---|
| `keep` | deleted (cascade) | **left untouched** in `<download_dir>/<Podcast Title>/` |
| `trash` | deleted (cascade) | moved to the **OS recycle bin** via Electron `shell.trashItem()` |

### UI

Clicking **Unsubscribe** opens a confirmation dialog (native `dialog.showMessageBox` in the main process, so it works regardless of renderer state):

```
Unsubscribe from "Radiolab"?

  [x] Move 42 downloaded episode files to the Recycle Bin
      (uncheck to keep them on disk)

                        [ Keep files ]  [ Move to Trash ]  [ Cancel ]
### Native modules: no compiler required

`better-sqlite3` v13 is compiled against **N-API v10** (`NAPI_VERSION=10` in
its `binding.gyp`) and ships **prebuilt binaries** for every supported platform
with **no `install` script**. N-API is ABI-stable across Node *and* Electron
versions, and Electron 45 ships Node 22.23.4, which supports N-API 10.

**Consequence:** the `postinstall: electron-builder install-app-deps` step
described in section 11 is *not required*, and no Visual C++ toolchain is
needed to build or run the app. This removes the single largest environment
risk from the original plan. The `npmRebuild: false` flag in
`electron-builder.yml` reflects this.

## 16. Implementation Notes and Deviations

Changes made while building, with the reasoning.

### 16.1 The preload script is CommonJS, not ESM

`electron-vite` emits an ESM preload (`.mjs`) when `package.json` has
`"type": "module"`. **Electron does not support ESM preload scripts in a
sandboxed renderer**, and the renderer runs with `sandbox: true`. The preload
build is therefore configured with `output.format: 'cjs'` and
`entryFileNames: '[name].cjs'`, and `resolvePreloadPath()` points at
`index.cjs`.

### 16.2 Feed URLs are canonicalised to `https`

`canonicaliseFeedUrl` lower-cases the host, strips `www.`, removes the
fragment and trailing slash, and **always normalises the protocol to `https`**.
Without this, `http://example.com/feed.xml` and `https://example.com/feed.xml`
would be two separate subscriptions to the same feed.

To avoid breaking the rare http-only feed, `fetchFeed` retries over plain
`http` when the `https` request fails with a non-2xx status.

### 16.3 `better-sqlite3` requires every named parameter to be present

A statement such as `UPDATE ... SET title = COALESCE(@title, title)` throws
`RangeError: Missing named parameter "title"` when the parameter object omits
the key, even if the value would have been unused. `PodcastRepo.updateMeta`
therefore always supplies every parameter, defaulting the absent ones to
`null` (which `COALESCE` treats as "leave unchanged"). This was a real bug
that broke subscribing entirely; it is now covered by a regression test.

### 16.4 The schema lives in TypeScript, not `.sql` files

`src/main/db/migrations.ts` holds the migration SQL as an inlined string
rather than reading `001_initial.sql` from disk at runtime. A file read via
`__dirname` would break inside the packaged asar archive; inlining the SQL
means electron-vite bundles it into the main-process chunk and the app behaves
identically in development and in a packaged build.

### 16.5 Stylesheet integrity is enforced by a test

Modern browsers support **native CSS nesting**, so a missing closing brace
silently nests the remainder of the stylesheet instead of raising a parse
error. A single missing brace in `components.css` left the filter panel, the
episode list and the player bar entirely unstyled with no console error.

`tests/styles.test.ts` now checks every stylesheet for balanced braces, for
accidentally nested rules, and for custom properties that are used but never
defined.

### 16.7 CSS: orphaned declarations and unclosed blocks hide real rules

`components.css` had three distinct breakages that combined to leave the player bar (and surrounding sections) entirely unstyled with **no console error**:

1. `.icon-play-done {` was opened but never closed, so every rule that followed — including all `.player-*` rules — was **nested inside** `.icon-play-done` and silently dropped by Chrome's native CSS nesting.
2. Three orphan declaration blocks (`gap: 10px; ...`, `font-size: 12px;`, `color: var(--success);`) sat outside any selector, doing nothing but compensating-braced to hide #1.
3. `.player-speed-menu button {` and `.feed-result {` were each missing their closing `}`.

Because braces still balanced overall (orphan `}`s canceled missing ones), the existing brace-balance test passed despite the damage. `tests/styles.test.ts` now additionally fails on declarations found at depth 0 (outside any rule) and on empty rule bodies (`{}`), so this class of bug cannot regress undetected again.

### 16.8 Settings dialog and native menu

The settings backend (`SettingsRepo`, `settings:getAll`/`settings:set` IPC) already existed but had
no UI. Added:

- `SettingsDialog` — theme, download directory (via `pickFolder`), auto-download default,
  check-updates-on-startup, global descriptions visibility, default playback speed and default
  volume. Every control writes through `setSetting` immediately (no Save button) and mirrors the
  change into the live `uiStore`/`playerStore` so the UI updates without a restart.
- A gear button in the `TitleBar` and a native **File → Settings…** menu item (macOS: app menu)
  with the `CmdOrCtrl+,` accelerator. The menu is built in `src/main/menu.ts` and sends
  `app:open-settings` to the renderer, which opens the dialog — the same path the gear uses.
- `APP_OPEN_SETTINGS` IPC channel + `onSettingsOpen` preload subscription.

Verified live: opening the dialog shows the stored values; toggling "Show descriptions" off
unchecks the matching FilterPanel box immediately; the download path field shows the real
`%APPDATA%\j-tunes\downloads` default.

### 16.9 Listening-experience feature batch

A large feature push, all verified against the running packaged app:

| Feature | Implementation |
|---|---|
| **Up Next + continuous playback** | `play_queue` table + `QueueRepo`; on `ended`, `usePlayer` marks the episode played and asks the main process for the next one (queue head, else the next unplayed episode in list order). |
| **Per-podcast auto-download** | Exposed the existing `podcast:setAutoDownload` IPC as a checkbox in the new `PodcastDetail` header. |
| **Podcast detail + artwork** | `PodcastDetail` renders `artworkUrl`, author, episode count, last-checked, description and the podcast-scoped actions. |
| **Bulk actions** | Row checkboxes + `BulkActionsBar`; `episodes:setPlayedMany` handles either explicit ids or a whole podcast, in one transaction. |
| **New-episode notifications** | `updates:completed` now triggers an OS `Notification` when episodes were added, the window is unfocused, and `notifyOnNewEpisodes` is on (new setting). |
| **Sleep timer** | `playerStore.sleepAt` + a poll in `usePlayer`; the player offers 15/30/45/60 min and Off. |
| **Chapters** | `podcast:chapters` URLs are parsed from feeds and stored per episode; `episodes:chapters` fetches the Podcast 2.0 JSON on first use, caches it in `chapters`, and the player offers click-to-seek. |
| **Listening stats** | `listening_stats` accumulates listening time from `player:savePosition` (forward deltas ≤ 90 s only, so seeks are ignored); `StatsRepo.summary()` returns totals, streak, per-podcast time and a 14-day chart. |

Fixes shipped alongside:

- **File menu is now visible** (`autoHideMenuBar: false`) so `File → Settings…` is discoverable on Windows.
- **`cancelImport` actually cancels** — it was a no-op stub; it now calls `Importer.cancel()`, and the wizard's button becomes "Stop import" mid-run.
- **Update progress is failure-isolated** — progress listeners are wrapped so a throwing callback cannot reject the whole sweep.
- **Settings volume slider is styled** to match the player (`.settings-range`).
- **CI added** (`.github/workflows/ci.yml`): install → typecheck → tests → build on every push and PR.

### 16.10 Streaming, storage management and hardening

| Area | Change |
|---|---|
| **Streaming** | `episode:mediaUrl` now falls back to `media_url` when there is no usable local file, and `MediaSource.streaming` reports which path was taken. The CSP gained `https: http:` under `media-src`. `EpisodeRow` plays anything with a remote URL instead of refusing until download completes. |
| **Storage manager** | New `library:storage` summary and `downloads:listDone` / `downloads:deleteMany` handlers back a "Manage Downloads" dialog: total size, per-podcast bars with bulk delete, and the 100 largest downloads with multi-select delete. Bulk deletes go through a `ConfirmDialog` that names the count and podcast before any file is touched. |
| **Importer performance** | Matching used to query every podcast per file (O(files × podcasts)). `Importer.buildIndex()` now builds `byPodcastName`, `byPodcastTitle` and `byTitle` maps once per run, so each file is O(1). |
| **Download all** | Podcast header gains a "Download all" button wired to the existing `downloads:enqueuePodcast` handler. |
| **Auto-mark played** | `usePlayer` marks an episode played once playback enters the resume tail (`duration − 15 s`), so skipping the last seconds still counts as finished. |
| **Trash semantics fixed** | `downloads:delete` parsed the whole request object against an enum, so single-episode delete always threw; and the file was unlinked *before* being "trashed". `clearDownload()` now only detaches the record, and disposal is a separate step. |
| **Marking played resets progress** | `played` changes zero `play_position` in all three paths so replay starts from the beginning. |
| **Error boundary** | `ErrorBoundary` wraps `<App/>` with Reload / Try again. |
| **Dead code removed** | `app:before-quit` emitted to a channel with no listener; removed. |
| **Accessibility** | Episode list is a `role="list"` of `listitem`s, and the play/played controls have descriptive `aria-label`s plus `aria-pressed`. |
| **Release workflow** | `.github/workflows/release.yml` builds the NSIS installer on `v*` tags and uploads it, honouring optional `CSC_LINK` / `CSC_KEY_PASSWORD` secrets for signing. |

Covered by new tests: `tests/chapters.test.ts` (Podcast 2.0 chapters URL) and `tests/playback.test.ts` (queue-first auto-advance, current-episode skipping, library fallback, exhaustion).

### 16.11 Queue reordering, OPML export and resumable downloads

| Area | Change |
|---|---|
| **Queue reordering** | The Up Next list gains ↑/↓ buttons wired to `queueStore.move()`, which reorders optimistically and persists through the previously unused `queue:reorder` handler. Buttons disable at the ends of the list. |
| **OPML export** | `services/opml.ts` builds a valid OPML 2.0 document (`escapeXml`, `buildOpml`, `exportableCount`), skipping `import://` pseudo feeds. `library:exportOpml` shows a save dialog and writes the file; the Settings dialog has a Subscriptions section with the button and a success toast. |
| **Resumable downloads** | `downloadFile` already supported `Range`/`206` handling and `.part` files; the manager never used it. `runDownload` now computes the destination, reads the leftover `.part` size via `partialSize` (also simplified and fixed), seeds `bytesDone`, and passes `resumeFrom`. `clearDownload` removes an orphaned `.part`. Because `uniquePath` only considers final names, a retry resolves to the same destination and therefore the same `.part`. |

Verified live: reordering swapped the two queued episodes and the buttons disabled at the range ends; the export wrote `j-tunes-subscriptions.opml` containing all three feeds with `&amp;` escaping, `htmlUrl` and `category`.

New tests: `tests/opml.test.ts` (escaping, metadata, imported-feed skipping, empty body) and `tests/downloadResume.test.ts` (`partialSize` reads `.part`, ignores finished files).

### 16.12 Remaining backlog

| Feature | Implementation |
|---|---|
| **OPML import** | `parseOpml` walks nested folder outlines, dedupes URLs and ignores non-HTTP entries. `subscribeToFeed` was extracted into `services/subscriptionService.ts` so both the subscribe handler and the new `OpmlImportService` share one code path. The importer subscribes with `UPDATE_CONCURRENCY` workers, counting added/skipped/failed and streaming `library:opmlProgress`; `library:importOpml` opens the picker and resolves with the summary, and `library:cancelOpmlImport` stops it. UI is `OpmlImportDialog` (also reachable from the command palette) with a progress bar, live counts and a Stop button. |
| **Continue Listening** | `SearchRepo.listInProgress()` returns unplayed episodes with `play_position > 10`, newest activity first; the strip refreshes when the list changes or playback stops (i.e. right after a position flush). |
| **Per-episode artwork** | `Episode` gained `podcastArtworkUrl` (joined from `podcasts.artwork_url`), and rows show `artworkUrl ?? podcastArtworkUrl` as a 40 px thumbnail. The same fallback powers the Continue Listening cards and the podcast header. |
| **Command palette** | `CommandPalette` (Ctrl/Cmd+K) merges static actions, the user's podcasts and debounced FTS episode search into one keyboard-navigable list (↑/↓/Enter/Esc). `ShortcutsDialog` (`?`) documents the bindings. `useKeyboardShortcuts` now ignores modifier combinations so Ctrl+K is not also "toggle play". |
| **Roving focus** | `EpisodeList` keeps one tab stop and moves it with ↑/↓/Home/End, calling `scrollToIndex` before focusing so the virtualised row exists; Enter plays the focused row. A `:focus-visible` outline makes the position visible. |

Verified live: Continue Listening rendered five cards with real artwork and percentages; the palette filtered to "Import subscriptions (OPML)" and opened the dialog; episode rows showed artwork thumbnails; ArrowDown moved the focus ring to the next row. The import path itself is covered by `tests/opmlImport.test.ts`, which stubs `fetch` to prove added/skipped/failed counting and progress reporting.

### 16.13 Final state

| Item | Result |
|---|---|
| Tests | 93 passed across 11 suites |
| TypeScript | both `tsconfig.node.json` and `tsconfig.web.json` clean |
| Build | `electron-vite build` succeeds |
| Packaging | `electron-builder --dir` produces `release\win-unpacked\j-Tunes.exe` |
| Smoke test | Packaged app launches, shows correct title, loads the live library (183 episodes), and the player bar is fully styled |

The player hook attaches `timeupdate`, `durationchange`, `play`, `pause`,
`waiting`, `playing`, `progress` and `ended` listeners to the `<audio>`
element. A `useRef` is not enough here, because the effect needs to re-run
once the element is actually mounted; the element is therefore held in state
and passed to the hook.

## 17. Verified Behaviour

Confirmed by driving the running application over the Chrome DevTools
Protocol against a live podcast feed (`https://feeds.megaphone.fm/darknetdiaries`).

| Check | Result |
|---|---|
| App launch | Window renders, no errors in the main-process log |
| Subscribe by feed URL | Podcast created with metadata |
| Startup auto-check | 183 episodes imported from the live feed |
| Manual **Check for Updates** | Reported 0 new episodes - the re-check is idempotent |
| Episode list | Titles, podcast, release dates and durations all correct |
| Virtualisation | 20 DOM rows rendered for 183 episodes |
| Search `"conti"` | 7 of 7 episodes matched, first result `180: Conti` |
| Year filter | 2026 selected -> 16 of 16 episodes |
| Theme toggle | `data-theme` switched dark -> light |
| Description toggle | Descriptions appeared on all rendered rows |
| Click to expand | Full description rendered for the clicked episode only |
| Speed menu | 1x / 1.2x / 1.5x / 2x offered; 1.5x applied to the element |
| Download | MP3 downloaded to disk; duration 219.5 s matched the feed exactly |
| Playback | Audio played from the `file://` URL at the persisted 1.5x rate |
| Position memory | Position stored, and playback resumed from it on restart |

### Performance

Measured with **50,000 episodes** seeded across 500 podcasts
(`tests/performance.test.ts`):

| Operation | Time |
|---|---|
| Full-text search | 1-4 ms |
| Filename search | 3 ms |
| Filter by year | 1 ms |
| Sort by release date | 1 ms |
| Sort by title / duration | 9 ms |
| Paginate (200 rows) | 1 ms |
| List distinct years | 22 ms |

---

```

- The checkbox is **checked by default** - the safer, tidier outcome.
- Unchecking it keeps the files, and the now-orphaned folder is left in place so nothing is ever destroyed without an explicit, visible choice.
- **Cancel** aborts the unsubscribe entirely.
- The chosen `fileAction` is passed back to the renderer and forwarded to the main process.

### Implementation notes

- `shell.trashItem(path)` is used rather than `fs.rm`, so files land in the Recycle Bin and are **recoverable** - a hard delete of a user's 2011 podcast library is never done implicitly.
- Each file is trashed individually and guarded by `try/catch`; a file locked by another process is reported in a toast and skipped rather than aborting the whole unsubscribe.
- The podcast's download folder is trashed only after all of its episode files have been dealt with. If the folder ends up empty, it is removed too.
- The DB deletion happens in a transaction and is rolled back if the file operation throws, so the UI never shows a podcast that was only half removed.
- The same `keep` / `trash` choice is reused by the per-episode **Delete download** action, where `trash` is the default (single file, recoverable via the Recycle Bin).

4. **Legacy import** - assume the legacy library is a flat folder of MP3/M4A/WAV files, possibly nested by show name; the importer handles both.
