import type { Db } from '../connection'
import type { Podcast } from '@shared/types'

interface PodcastRow {
  id: number
  feed_url: string
  title: string
  author: string | null
  description: string | null
  description_html: string | null
  artwork_url: string | null
  category: string | null
  language: string | null
  link: string | null
  last_checked_at: number | null
  last_episode_at: number | null
  episode_count: number
  subscribed_at: number
  auto_download: number
  is_active: number
  sort_order: number
}

function toPodcast(row: PodcastRow): Podcast {
  return {
    id: row.id,
    feedUrl: row.feed_url,
    title: row.title,
    author: row.author,
    description: row.description,
    descriptionHtml: row.description_html,
    artworkUrl: row.artwork_url,
    category: row.category,
    language: row.language,
    link: row.link,
    lastCheckedAt: row.last_checked_at,
    lastEpisodeAt: row.last_episode_at,
    episodeCount: row.episode_count,
    subscribedAt: row.subscribed_at,
    autoDownload: row.auto_download === 1,
    isActive: row.is_active === 1,
    sortOrder: row.sort_order
  }
}

export class PodcastRepo {
  constructor(private readonly db: Db) {}

  list(includeInactive = false): Podcast[] {
    const sql = includeInactive
      ? 'SELECT * FROM podcasts ORDER BY sort_order ASC, title COLLATE NOCASE ASC'
      : 'SELECT * FROM podcasts WHERE is_active = 1 ORDER BY sort_order ASC, title COLLATE NOCASE ASC'
    const rows = this.db.prepare(sql).all() as PodcastRow[]
    return rows.map(toPodcast)
  }

  getById(id: number): Podcast | null {
    const row = this.db.prepare('SELECT * FROM podcasts WHERE id = ?').get(id) as PodcastRow | undefined
    return row ? toPodcast(row) : null
  }

  getByFeedUrl(feedUrl: string): Podcast | null {
    const row = this.db.prepare('SELECT * FROM podcasts WHERE feed_url = ?').get(feedUrl) as
      | PodcastRow
      | undefined
    return row ? toPodcast(row) : null
  }

  /** Feed metadata needed for a conditional GET. */
  getFeedMeta(id: number): { etag: string | null; lastModified: string | null } | null {
    const row = this.db
      .prepare('SELECT etag, last_modified FROM podcasts WHERE id = ?')
      .get(id) as { etag: string | null; last_modified: string | null } | undefined
    if (!row) return null
    return { etag: row.etag, lastModified: row.last_modified }
  }

  create(input: {
    feedUrl: string
    title: string
    author?: string | null
    description?: string | null
    descriptionHtml?: string | null
    artworkUrl?: string | null
    category?: string | null
    language?: string | null
    link?: string | null
    autoDownload?: boolean
  }): Podcast {
    const now = Date.now()
    const nextOrder = this.db
      .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM podcasts')
      .get() as { n: number }

    const info = this.db
      .prepare(
        `INSERT INTO podcasts
           (feed_url, title, author, description, description_html, artwork_url, category,
            language, link, subscribed_at, auto_download, is_active, sort_order)
         VALUES (@feedUrl, @title, @author, @description, @descriptionHtml, @artworkUrl, @category,
                 @language, @link, @now, @autoDownload, 1, @sortOrder)`
      )
      .run({
        feedUrl: input.feedUrl,
        title: input.title,
        author: input.author ?? null,
        description: input.description ?? null,
        descriptionHtml: input.descriptionHtml ?? null,
        artworkUrl: input.artworkUrl ?? null,
        category: input.category ?? null,
        language: input.language ?? null,
        link: input.link ?? null,
        now,
        autoDownload: input.autoDownload === false ? 0 : 1,
        sortOrder: nextOrder.n
      })

    return this.getById(Number(info.lastInsertRowid))!
  }

  /**
   * Updates the podcast's metadata.
   *
   * Every named parameter is always supplied - better-sqlite3 requires all
   * of a statement's named parameters to be present, even when the value is
   * unused. A null value leaves the existing column unchanged.
   */
  updateMeta(
    id: number,
    meta: {
      title?: string
      author?: string | null
      description?: string | null
      descriptionHtml?: string | null
      artworkUrl?: string | null
      category?: string | null
      language?: string | null
      link?: string | null
      etag?: string | null
      lastModified?: string | null
    }
  ): void {
    this.db
      .prepare(
        `UPDATE podcasts SET
           title = COALESCE(@title, title),
           author = COALESCE(@author, author),
           description = COALESCE(@description, description),
           description_html = COALESCE(@descriptionHtml, description_html),
           artwork_url = COALESCE(@artworkUrl, artwork_url),
           category = COALESCE(@category, category),
           language = COALESCE(@language, language),
           link = COALESCE(@link, link),
           etag = COALESCE(@etag, etag),
           last_modified = COALESCE(@lastModified, last_modified)
         WHERE id = @id`
      )
      .run({
        id,
        title: meta.title ?? null,
        author: meta.author ?? null,
        description: meta.description ?? null,
        descriptionHtml: meta.descriptionHtml ?? null,
        artworkUrl: meta.artworkUrl ?? null,
        category: meta.category ?? null,
        language: meta.language ?? null,
        link: meta.link ?? null,
        etag: meta.etag ?? null,
        lastModified: meta.lastModified ?? null
      })
  }

  setChecked(id: number, etag: string | null, lastModified: string | null): void {
    this.db
      .prepare(
        `UPDATE podcasts
         SET last_checked_at = @now,
             etag = COALESCE(@etag, etag),
             last_modified = COALESCE(@lastModified, last_modified)
         WHERE id = @id`
      )
      .run({ id, now: Date.now(), etag, lastModified })
  }

  setAutoDownload(id: number, autoDownload: boolean): void {
    this.db
      .prepare('UPDATE podcasts SET auto_download = ? WHERE id = ?')
      .run(autoDownload ? 1 : 0, id)
  }

  /**
   * Removes the podcast. Episode rows cascade via the foreign key.
   */
  remove(id: number): void {
    this.db.prepare('DELETE FROM podcasts WHERE id = ?').run(id)
  }

  /** Returns the file paths of every downloaded episode for a podcast. */
  getDownloadedFilePaths(id: number): string[] {
    const rows = this.db
      .prepare('SELECT file_path FROM episodes WHERE podcast_id = ? AND file_path IS NOT NULL')
      .all(id) as { file_path: string }[]
    return rows.map((r) => r.file_path)
  }

  /** Recomputes the denormalised counters after a feed sync. */
  refreshCounters(id: number): void {
    this.db
      .prepare(
        `UPDATE podcasts SET
           episode_count = (SELECT COUNT(*) FROM episodes WHERE podcast_id = @id),
           last_episode_at = (SELECT MAX(release_date) FROM episodes WHERE podcast_id = @id)
         WHERE id = @id`
      )
      .run({ id })
  }
}
