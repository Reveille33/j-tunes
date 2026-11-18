/**
 * Ordered schema migrations.
 *
 * The SQL is inlined as TypeScript rather than read from `.sql` files at
 * runtime, so electron-vite bundles it into the main-process chunk and the
 * app works identically in development and in a packaged asar archive.
 */
export interface Migration {
  version: string
  sql: string
}

export const MIGRATIONS: Migration[] = [
  {
    version: '001_initial',
    sql: `
CREATE TABLE IF NOT EXISTS podcasts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  feed_url          TEXT    NOT NULL UNIQUE,
  title             TEXT    NOT NULL,
  author            TEXT,
  description       TEXT,
  description_html  TEXT,
  artwork_url       TEXT,
  category          TEXT,
  language          TEXT,
  link              TEXT,
  etag              TEXT,
  last_modified     TEXT,
  last_checked_at   INTEGER,
  last_episode_at   INTEGER,
  episode_count     INTEGER NOT NULL DEFAULT 0,
  subscribed_at     INTEGER NOT NULL,
  auto_download     INTEGER NOT NULL DEFAULT 1,
  is_active         INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_podcasts_last_episode ON podcasts(is_active, last_episode_at DESC);
CREATE INDEX IF NOT EXISTS idx_podcasts_title        ON podcasts(title COLLATE NOCASE);

CREATE TABLE IF NOT EXISTS episodes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  podcast_id      INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
  guid            TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  description     TEXT,
  description_html TEXT,
  media_url       TEXT,
  media_type      TEXT,
  media_length    INTEGER,
  duration_secs   INTEGER,
  release_date    INTEGER,
  episode_number  INTEGER,
  season_number   INTEGER,
  artwork_url     TEXT,
  file_path       TEXT,
  file_size       INTEGER,
  download_state  TEXT    NOT NULL DEFAULT 'none',
  download_error  TEXT,
  played          INTEGER NOT NULL DEFAULT 0,
  play_position   REAL    NOT NULL DEFAULT 0,
  duration_known  REAL,
  is_imported     INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (podcast_id, guid)
);

CREATE INDEX IF NOT EXISTS idx_episodes_podcast_date ON episodes(podcast_id, release_date DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_release_date  ON episodes(release_date DESC);
CREATE INDEX IF NOT EXISTS idx_episodes_download      ON episodes(download_state);
CREATE INDEX IF NOT EXISTS idx_episodes_played        ON episodes(played);
CREATE INDEX IF NOT EXISTS idx_episodes_file_path     ON episodes(file_path);
CREATE INDEX IF NOT EXISTS idx_episodes_title         ON episodes(title COLLATE NOCASE);

-- Full-text search over title, description and local filename.
-- External-content mode keeps only the index, not a second copy of the text.
CREATE VIRTUAL TABLE IF NOT EXISTS episode_search USING fts5(
  title,
  description,
  file_path,
  content = 'episodes',
  content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS episodes_ai AFTER INSERT ON episodes BEGIN
  INSERT INTO episode_search(rowid, title, description, file_path)
  VALUES (new.id, new.title, new.description, new.file_path);
END;

CREATE TRIGGER IF NOT EXISTS episodes_ad AFTER DELETE ON episodes BEGIN
  INSERT INTO episode_search(episode_search, rowid, title, description, file_path)
  VALUES ('delete', old.id, old.title, old.description, old.file_path);
END;

CREATE TRIGGER IF NOT EXISTS episodes_au AFTER UPDATE OF title, description, file_path ON episodes BEGIN
  INSERT INTO episode_search(episode_search, rowid, title, description, file_path)
  VALUES ('delete', old.id, old.title, old.description, old.file_path);
  INSERT INTO episode_search(rowid, title, description, file_path)
  VALUES (new.id, new.title, new.description, new.file_path);
END;

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS import_jobs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source_dir  TEXT NOT NULL,
  started_at  INTEGER NOT NULL,
  finished_at INTEGER,
  files_seen  INTEGER NOT NULL DEFAULT 0,
  files_matched  INTEGER NOT NULL DEFAULT 0,
  files_added   INTEGER NOT NULL DEFAULT 0,
  files_skipped INTEGER NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'running'
);
`
  },
  {
    version: '002_features',
    sql: `
-- Chapters for an episode, sourced from a Podcast 2.0 chapters document.
CREATE TABLE IF NOT EXISTS chapters (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  start_secs REAL    NOT NULL,
  title      TEXT    NOT NULL,
  UNIQUE (episode_id, start_secs)
);

CREATE INDEX IF NOT EXISTS idx_chapters_episode ON chapters(episode_id, start_secs);

-- The "Up Next" playback queue. Position is a dense ordering the user controls.
CREATE TABLE IF NOT EXISTS play_queue (
  episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  position   INTEGER NOT NULL,
  added_at   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_play_queue_position ON play_queue(position);

-- Daily listening totals, used by the stats view. Appended as playback advances.
CREATE TABLE IF NOT EXISTS listening_stats (
  day     TEXT    PRIMARY KEY,
  seconds INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE episodes ADD COLUMN chapters_url TEXT;
`
  },
  {
    version: '003_drop_download_queue',
    sql: `
-- The queue was never written. Episode download_state is enough to rebuild
-- in-flight work after a restart, so the unused table is removed.
DROP TABLE IF EXISTS download_queue;
`
  },
  {
    version: '004_podcast_last_error',
    sql: `
ALTER TABLE podcasts ADD COLUMN last_error TEXT;
`
  }
]
