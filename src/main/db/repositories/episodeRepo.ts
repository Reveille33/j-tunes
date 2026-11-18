import type { Db } from '../connection'
import type { DownloadState, ParsedEpisode } from '@shared/types'

export interface EpisodeInsert {
  podcastId: number
  guid: string
  title: string
  description?: string | null
  descriptionHtml?: string | null
  mediaUrl?: string | null
  mediaType?: string | null
  mediaLength?: number | null
  durationSecs?: number | null
  releaseDate?: number | null
  episodeNumber?: number | null
  seasonNumber?: number | null
  artworkUrl?: string | null
  chaptersUrl?: string | null
  filePath?: string | null
  fileSize?: number | null
  isImported?: boolean
}

export class EpisodeRepo {
  constructor(private readonly db: Db) {}

  /**
   * Inserts episodes. A guid that already exists for the podcast is not
   * inserted again, which keeps a feed re-check idempotent.
   *
   * When that existing row's title, media URL, media type, or duration
   * differs from the feed, those fields are updated. Playback, download
   * state, and the local file path are left alone. A null incoming value
   * does not wipe a value already stored.
   *
   * Returns the ids of the genuinely new rows.
   */
  insertMany(podcastId: number, episodes: ParsedEpisode[]): number[] {
    if (episodes.length === 0) return []

    const now = Date.now()
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO episodes
         (podcast_id, guid, title, description, description_html, media_url, media_type,
          media_length, duration_secs, release_date, episode_number, season_number,
          artwork_url, chapters_url, created_at, updated_at)
       VALUES (@podcastId, @guid, @title, @description, @descriptionHtml, @mediaUrl, @mediaType,
               @mediaLength, @durationSecs, @releaseDate, @episodeNumber, @seasonNumber,
               @artworkUrl, @chaptersUrl, @now, @now)`
    )
    const refreshExisting = this.db.prepare(
      `UPDATE episodes SET
         title = CASE WHEN @title IS NOT NULL AND title IS NOT @title THEN @title ELSE title END,
         media_url = CASE WHEN @mediaUrl IS NOT NULL AND media_url IS NOT @mediaUrl THEN @mediaUrl ELSE media_url END,
         media_type = CASE WHEN @mediaType IS NOT NULL AND media_type IS NOT @mediaType THEN @mediaType ELSE media_type END,
         duration_secs = CASE WHEN @durationSecs IS NOT NULL AND duration_secs IS NOT @durationSecs THEN @durationSecs ELSE duration_secs END,
         updated_at = @now
       WHERE podcast_id = @podcastId
         AND guid = @guid
         AND (
           (@title IS NOT NULL AND title IS NOT @title)
           OR (@mediaUrl IS NOT NULL AND media_url IS NOT @mediaUrl)
           OR (@mediaType IS NOT NULL AND media_type IS NOT @mediaType)
           OR (@durationSecs IS NOT NULL AND duration_secs IS NOT @durationSecs)
         )`
    )

    const run = this.db.transaction((rows: ParsedEpisode[]) => {
      const ids: number[] = []
      for (const ep of rows) {
        const params = {
          podcastId,
          guid: ep.guid,
          title: ep.title,
          description: ep.description ?? null,
          descriptionHtml: ep.descriptionHtml ?? null,
          mediaUrl: ep.mediaUrl ?? null,
          mediaType: ep.mediaType ?? null,
          mediaLength: ep.mediaLength ?? null,
          durationSecs: ep.durationSecs ?? null,
          releaseDate: ep.releaseDate ?? null,
          episodeNumber: ep.episodeNumber ?? null,
          seasonNumber: ep.seasonNumber ?? null,
          artworkUrl: ep.artworkUrl ?? null,
          chaptersUrl: ep.chaptersUrl ?? null,
          now
        }
        const info = insert.run(params)
        if (info.changes > 0) ids.push(Number(info.lastInsertRowid))
        else refreshExisting.run(params)
      }
      return ids
    })

    return run(episodes)
  }

  /** Inserts a single imported episode, returning its id. */
  insertImported(input: EpisodeInsert): number {
    const now = Date.now()
    const info = this.db
      .prepare(
        `INSERT OR IGNORE INTO episodes
           (podcast_id, guid, title, description, description_html, media_url, media_type,
            media_length, duration_secs, release_date, episode_number, season_number,
            artwork_url, file_path, file_size, download_state, duration_known, is_imported,
            created_at, updated_at)
         VALUES (@podcastId, @guid, @title, @description, @descriptionHtml, @mediaUrl, @mediaType,
                 @mediaLength, @durationSecs, @releaseDate, @episodeNumber, @seasonNumber,
                 @artworkUrl, @filePath, @fileSize, 'done', @durationKnown, 1, @now, @now)`
      )
      .run({
        podcastId: input.podcastId,
        guid: input.guid,
        title: input.title,
        description: input.description ?? null,
        descriptionHtml: input.descriptionHtml ?? null,
        mediaUrl: input.mediaUrl ?? null,
        mediaType: input.mediaType ?? null,
        mediaLength: input.mediaLength ?? null,
        durationSecs: input.durationSecs ?? null,
        releaseDate: input.releaseDate ?? null,
        episodeNumber: input.episodeNumber ?? null,
        seasonNumber: input.seasonNumber ?? null,
        artworkUrl: input.artworkUrl ?? null,
        filePath: input.filePath ?? null,
        fileSize: input.fileSize ?? null,
        durationKnown: input.durationSecs ?? null,
        now
      })

    if (info.changes > 0) return Number(info.lastInsertRowid)

    // A previous import of this file may have stored the row without a path.
    if (input.filePath) this.repairNullFilePath(input.guid, input.filePath, input.fileSize ?? null)

    const existing = this.db
      .prepare('SELECT id FROM episodes WHERE podcast_id = ? AND guid = ?')
      .get(input.podcastId, input.guid) as { id: number } | undefined
    return existing?.id ?? Number(info.lastInsertRowid)
  }

  /**
   * Fills in file_path and file_size on an imported row that was stored
   * without them. Returns true when a row was repaired.
   */
  repairNullFilePath(guid: string, filePath: string, fileSize: number | null): boolean {
    const info = this.db
      .prepare(
        `UPDATE episodes
         SET file_path = @filePath, file_size = @fileSize, updated_at = @now
         WHERE guid = @guid AND file_path IS NULL`
      )
      .run({ guid, filePath, fileSize, now: Date.now() })
    return info.changes > 0
  }

  /** Links a local file to an existing episode (legacy import match). */
  attachFile(id: number, filePath: string, fileSize: number, durationSecs: number | null): void {
    this.db
      .prepare(
        `UPDATE episodes SET
           file_path = @filePath,
           file_size = @fileSize,
           duration_secs = COALESCE(@durationSecs, duration_secs),
           duration_known = COALESCE(@durationSecs, duration_known),
           download_state = 'done',
           download_error = NULL,
           is_imported = 1,
           updated_at = @now
         WHERE id = @id`
      )
      .run({ id, filePath, fileSize, durationSecs, now: Date.now() })
  }

  getById(id: number): (EpisodeRow & { podcast_title: string }) | null {
    const row = this.db
      .prepare(
        `SELECT e.*, p.title AS podcast_title FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id WHERE e.id = ?`
      )
      .get(id) as (EpisodeRow & { podcast_title: string }) | undefined
    return row ?? null
  }

  getFilePath(id: number): string | null {
    const row = this.db.prepare('SELECT file_path FROM episodes WHERE id = ?').get(id) as
      | { file_path: string | null }
      | undefined
    return row?.file_path ?? null
  }

  findByFilePath(filePath: string): { id: number } | null {
    const row = this.db.prepare('SELECT id FROM episodes WHERE file_path = ?').get(filePath) as
      | { id: number }
      | undefined
    return row ?? null
  }

  /** Finds an episode by a normalised title within a podcast. */
  findByNormalisedTitle(podcastId: number, normalisedTitle: string): { id: number } | null {
    const row = this.db
      .prepare(
        `SELECT id FROM episodes
         WHERE podcast_id = @podcastId
           AND LOWER(TRIM(title)) = @normalisedTitle
         LIMIT 1`
      )
      .get({ podcastId, normalisedTitle }) as { id: number } | undefined
    return row ?? null
  }

  setPlayed(id: number, played: boolean): void {
    // Marking played also clears the resume point, so replaying starts over.
    this.db
      .prepare('UPDATE episodes SET played = ?, play_position = 0, updated_at = ? WHERE id = ?')
      .run(played ? 1 : 0, Date.now(), id)
  }

  /** Marks many episodes played/unplayed in a single transaction. */
  setPlayedMany(ids: number[], played: boolean): void {
    if (ids.length === 0) return
    const now = Date.now()
    const update = this.db.prepare(
      'UPDATE episodes SET played = ?, play_position = 0, updated_at = ? WHERE id = ?'
    )
    const run = this.db.transaction((list: number[]) => {
      for (const id of list) update.run(played ? 1 : 0, now, id)
    })
    run(ids)
  }

  /** Marks every episode of a podcast played/unplayed. */
  setPlayedForPodcast(podcastId: number, played: boolean, onlyUnplayed: boolean): void {
    const now = Date.now()
    if (played && onlyUnplayed) {
      this.db
        .prepare(
          'UPDATE episodes SET played = 1, play_position = 0, updated_at = ? WHERE podcast_id = ? AND played = 0'
        )
        .run(now, podcastId)
      return
    }
    this.db
      .prepare(
        'UPDATE episodes SET played = ?, play_position = 0, updated_at = ? WHERE podcast_id = ?'
      )
      .run(played ? 1 : 0, now, podcastId)
  }

  /**
   * The next unplayed episode to play after `currentId`, for continuous
   * playback. Follows newest-first order on (release_date, id): the closest
   * earlier row, wrapping to the newest playable episode when there is none.
   * An episode with neither a media URL nor a downloaded file is skipped.
   */
  nextUnplayedAfter(
    releaseDate: number | null,
    currentId: number,
    podcastId: number | null
  ): number | null {
    const podcastClause = podcastId != null ? ' AND podcast_id = @podcastId' : ''
    const playable = ` AND (
      (media_url IS NOT NULL AND media_url != '')
      OR (file_path IS NOT NULL AND file_path != '')
    )`

    const olderParams: Record<string, unknown> = {
      currentId,
      releaseDate: releaseDate ?? 0
    }
    if (podcastId != null) olderParams.podcastId = podcastId

    const older = this.db
      .prepare(
        `SELECT id FROM episodes
         WHERE played = 0 AND id != @currentId${podcastClause}${playable}
           AND (
             COALESCE(release_date, 0) < @releaseDate
             OR (COALESCE(release_date, 0) = @releaseDate AND id < @currentId)
           )
         ORDER BY COALESCE(release_date, 0) DESC, id DESC
         LIMIT 1`
      )
      .get(olderParams) as { id: number } | undefined
    if (older) return older.id

    const wrapParams: Record<string, unknown> = { currentId }
    if (podcastId != null) wrapParams.podcastId = podcastId

    const wrapped = this.db
      .prepare(
        `SELECT id FROM episodes
         WHERE played = 0 AND id != @currentId${podcastClause}${playable}
         ORDER BY COALESCE(release_date, 0) DESC, id DESC
         LIMIT 1`
      )
      .get(wrapParams) as { id: number } | undefined
    return wrapped?.id ?? null
  }

  /** Reads the chapter document URL advertised by the feed, if any. */
  getChaptersUrl(id: number): string | null {
    const row = this.db.prepare('SELECT chapters_url FROM episodes WHERE id = ?').get(id) as
      | { chapters_url: string | null }
      | undefined
    return row?.chapters_url ?? null
  }

  setPlayPosition(id: number, position: number, duration: number): void {
    this.db
      .prepare(
        `UPDATE episodes SET
           play_position = ?,
           duration_known = COALESCE(?, duration_known),
           updated_at = ?
         WHERE id = ?`
      )
      .run(position, duration > 0 ? duration : null, Date.now(), id)
  }

  setDownloadState(id: number, state: DownloadState, error: string | null = null): void {
    this.db
      .prepare(
        'UPDATE episodes SET download_state = ?, download_error = ?, updated_at = ? WHERE id = ?'
      )
      .run(state, error, Date.now(), id)
  }

  /**
   * A process that died mid-transfer leaves rows in `downloading`. Nothing is
   * actually running after a restart, so mark them paused. The partial file
   * stays on disk and a later resume continues it.
   */
  resetDownloadingToPaused(): number {
    const info = this.db
      .prepare(
        `UPDATE episodes
         SET download_state = 'paused', download_error = NULL, updated_at = ?
         WHERE download_state = 'downloading'`
      )
      .run(Date.now())
    return info.changes
  }

  /** Episode ids in a download state that still have a remote media URL. */
  listIdsByDownloadState(state: DownloadState): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM episodes
         WHERE download_state = ? AND media_url IS NOT NULL
         ORDER BY id ASC`
      )
      .all(state) as { id: number }[]
    return rows.map((row) => row.id)
  }

  setFilePath(id: number, filePath: string | null, fileSize: number | null): void {
    this.db
      .prepare('UPDATE episodes SET file_path = ?, file_size = ?, updated_at = ? WHERE id = ?')
      .run(filePath, fileSize, Date.now(), id)
  }

  /** Distinct years that have episodes, newest first - drives the year filter. */
  listYears(): number[] {
    const rows = this.db
      .prepare(
        `SELECT DISTINCT CAST(strftime('%Y', release_date / 1000, 'unixepoch', 'localtime') AS INTEGER) AS y
         FROM episodes
         WHERE release_date IS NOT NULL
         ORDER BY y DESC`
      )
      .all() as { y: number }[]
    return rows.map((r) => r.y).filter((y) => Number.isFinite(y))
  }

  /** Every episode of a podcast, newest first. */
  listForPodcast(podcastId: number): EpisodeRow[] {
    return this.db
      .prepare(
        `SELECT * FROM episodes
         WHERE podcast_id = ?
         ORDER BY COALESCE(release_date, 0) DESC, id DESC`
      )
      .all(podcastId) as EpisodeRow[]
  }

  /** Episode ids of a podcast that have a media URL and are not downloaded. */
  listDownloadableIds(podcastId: number): number[] {
    const rows = this.db
      .prepare(
        `SELECT id FROM episodes
         WHERE podcast_id = ?
           AND media_url IS NOT NULL
           AND download_state != 'done'`
      )
      .all(podcastId) as { id: number }[]
    return rows.map((r) => r.id)
  }

  /**
   * Every episode's id and title, for the importer's in-memory matching index.
   * A single query beats a lookup per file per podcast.
   */
  listForMatching(): { id: number; podcastId: number; title: string }[] {
    const rows = this.db.prepare('SELECT id, podcast_id, title FROM episodes').all() as {
      id: number
      podcast_id: number
      title: string
    }[]
    return rows.map((r) => ({ id: r.id, podcastId: r.podcast_id, title: r.title }))
  }

  /** Ids of downloaded episodes for a podcast, used for bulk deletion. */
  listDownloadedIdsForPodcast(podcastId: number): number[] {
    const rows = this.db
      .prepare("SELECT id FROM episodes WHERE podcast_id = ? AND download_state = 'done'")
      .all(podcastId) as { id: number }[]
    return rows.map((r) => r.id)
  }
}

export interface EpisodeRow {
  id: number
  podcast_id: number
  guid: string
  title: string
  description: string | null
  description_html: string | null
  media_url: string | null
  media_type: string | null
  media_length: number | null
  duration_secs: number | null
  release_date: number | null
  episode_number: number | null
  season_number: number | null
  artwork_url: string | null
  file_path: string | null
  file_size: number | null
  download_state: string
  download_error: string | null
  played: number
  play_position: number
  duration_known: number | null
  is_imported: number
  created_at: number
  updated_at: number
}

