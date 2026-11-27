import { knownPrecision } from '@shared/releaseDate'
import type { Db } from '../connection'
import { releaseYearSql } from '../releaseYearSql'
import type { Episode, EpisodePage, EpisodeQuery, SortBy } from '@shared/types'

interface SearchRow {
  id: number
  podcast_id: number
  podcast_title: string
  guid: string
  title: string
  description: string | null
  description_html: string | null
  media_url: string | null
  media_type: string | null
  duration_secs: number | null
  release_date: number | null
  release_precision: string | null
  episode_number: number | null
  season_number: number | null
  artwork_url: string | null
  podcast_artwork_url: string | null
  file_path: string | null
  file_size: number | null
  download_state: string
  download_error: string | null
  played: number
  play_position: number
  is_imported: number
}

function toEpisode(row: SearchRow): Episode {
  return {
    id: row.id,
    podcastId: row.podcast_id,
    podcastTitle: row.podcast_title,
    guid: row.guid,
    title: row.title,
    description: row.description,
    descriptionHtml: row.description_html,
    mediaUrl: row.media_url,
    mediaType: row.media_type,
    durationSecs: row.duration_secs,
    releaseDate: row.release_date,
    releasePrecision: knownPrecision(row.release_precision),
    episodeNumber: row.episode_number,
    seasonNumber: row.season_number,
    artworkUrl: row.artwork_url,
    podcastArtworkUrl: row.podcast_artwork_url,
    filePath: row.file_path,
    fileSize: row.file_size,
    downloadState: row.download_state as Episode['downloadState'],
    downloadError: row.download_error,
    played: row.played === 1,
    playPosition: row.play_position,
    isImported: row.is_imported === 1
  }
}

/**
 * Escapes a user-supplied string for use inside an FTS5 MATCH expression.
 * Unquoted input is interpreted as FTS5 syntax, so special characters are
 * quoted and internal double quotes doubled.
 */
export function toFtsQuery(input: string): string {
  const terms = input
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
  return terms.join(' AND ')
}

/** Escapes LIKE wildcards so a user's `%` is matched literally. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (c) => `\\${c}`)
}

/**
 * Computes the epoch-ms bounds of a calendar year in the local timezone, so
 * the year filter can use the indexed `release_date` range directly.
 */
export function yearBounds(year: number): { start: number; end: number } {
  const start = new Date(year, 0, 1, 0, 0, 0, 0).getTime()
  const end = new Date(year + 1, 0, 1, 0, 0, 0, 0).getTime()
  return { start, end }
}

/**
 * Builds the ORDER BY clause from an allow-list. The sort key is never
 * interpolated from raw user input.
 */
function orderBy(sortBy: SortBy, direction: 'asc' | 'desc'): string {
  const dir = direction === 'asc' ? 'ASC' : 'DESC'
  switch (sortBy) {
    case 'title':
      return `e.title COLLATE NOCASE ${dir}`
    case 'duration':
      return `COALESCE(e.duration_secs, 0) ${dir}`
    case 'podcast':
      return `p.title COLLATE NOCASE ${dir}, e.release_date DESC`
    case 'relevance':
      return `rank ASC, e.release_date DESC`
    case 'release_date':
    default:
      return `e.release_date ${dir} NULLS LAST`
  }
}

export class SearchRepo {
  constructor(private readonly db: Db) {}

  /** Episodes by id, preserving the given order (used by the play queue). */
  listByIds(ids: number[]): Episode[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.db
      .prepare(
        `SELECT e.*, p.title AS podcast_title, p.artwork_url AS podcast_artwork_url
         FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE e.id IN (${placeholders})`
      )
      .all(...ids) as SearchRow[]
    const byId = new Map(rows.map((r) => [r.id, toEpisode(r)]))
    return ids.map((id) => byId.get(id)).filter((e): e is Episode => Boolean(e))
  }

  /** Downloaded episodes, largest first, for the storage manager. */
  listDownloaded(limit = 300): Episode[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, p.title AS podcast_title, p.artwork_url AS podcast_artwork_url
         FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE e.download_state = 'done'
         ORDER BY COALESCE(e.file_size, 0) DESC, e.title COLLATE NOCASE ASC
         LIMIT ?`
      )
      .all(limit) as SearchRow[]
    return rows.map(toEpisode)
  }

  /** Partially played episodes, for the Continue Listening strip. */
  listInProgress(limit = 8): Episode[] {
    const rows = this.db
      .prepare(
        `SELECT e.*, p.title AS podcast_title, p.artwork_url AS podcast_artwork_url
         FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE e.played = 0 AND e.play_position > 10
         ORDER BY e.updated_at DESC
         LIMIT ?`
      )
      .all(limit) as SearchRow[]
    return rows.map(toEpisode)
  }

  query(query: EpisodeQuery): EpisodePage {
    const filters = query.filters ?? {}
    const sortBy: SortBy = query.sortBy ?? 'release_date'
    const direction =
      query.direction ?? (sortBy === 'title' || sortBy === 'podcast' ? 'asc' : 'desc')
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 1000)
    const offset = Math.max(query.offset ?? 0, 0)

    const where: string[] = []
    const params: Record<string, unknown> = {
      limit,
      offset,
      podcastId: filters.podcastId ?? null,
      played: filters.played === undefined || filters.played === null ? null : filters.played ? 1 : 0,
      downloadState: filters.downloadState ?? null,
      descriptionTerm: filters.descriptionTerm?.trim() || null
    }

    // Free-text search uses the FTS5 index, so it must be a MATCH join.
    const text = filters.text?.trim()
    const useFts = Boolean(text)
    if (useFts) {
      params.ftsQuery = toFtsQuery(text!)
    }

    if (filters.podcastId != null) {
      where.push('e.podcast_id = @podcastId')
    }

    if (filters.year != null) {
      // The displayed year still decides membership, but each branch starts
      // with a release_date range so the 50k-episode library uses the index
      // instead of running the year expression on every row.
      const bounds = yearBounds(filters.year)
      params.year = filters.year
      params.yearStart = bounds.start
      params.yearEnd = bounds.end
      params.utcYearStart = Date.UTC(filters.year, 0, 1)
      params.utcYearEnd = Date.UTC(filters.year + 1, 0, 1)
      const displayed = `${releaseYearSql('e')} = @year`
      const notLocalNewYear =
        "NOT ((e.release_date % 1000) = 0 AND strftime('%m-%d %H:%M:%S', e.release_date / 1000, 'unixepoch', 'localtime') = '01-01 00:00:00')"
      const utcNoon =
        "(e.release_date % 1000) = 0 AND strftime('%H:%M:%S', e.release_date / 1000, 'unixepoch') = '12:00:00'"
      where.push(`(
        (e.release_date >= @yearStart AND e.release_date < @yearEnd AND ${displayed})
        OR (e.release_precision = 'year'
            AND e.release_date >= @utcYearStart AND e.release_date < @utcYearEnd
            AND ${notLocalNewYear}
            AND ${displayed})
        OR (${utcNoon}
            AND e.release_date >= @utcYearStart AND e.release_date < @utcYearEnd
            AND ${displayed})
      )`)
    }

    if (params.played !== null) {
      where.push('e.played = @played')
    }

    if (filters.downloadState != null) {
      where.push('e.download_state = @downloadState')
    }

    if (params.descriptionTerm) {
      params.descriptionPattern = `%${escapeLike(params.descriptionTerm as string)}%`
      where.push("e.description LIKE @descriptionPattern ESCAPE '\\'")
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
    // When joining through the FTS table the predicate list is appended to an
    // existing WHERE clause rather than replacing it.
    const whereAnd = whereSql ? ` AND ${whereSql.replace(/^WHERE /, '')}` : ''

    const fromSql = useFts
      ? `FROM episode_search s
         JOIN episodes e ON e.id = s.rowid
         JOIN podcasts p ON p.id = e.podcast_id
         WHERE episode_search MATCH @ftsQuery${whereAnd}`
      : `FROM episodes e
         JOIN podcasts p ON p.id = e.podcast_id
         ${whereSql}`

    const rankSelect = useFts ? ', bm25(episode_search) AS rank' : ''

    const rows = this.db
      .prepare(
        `SELECT e.*, p.title AS podcast_title, p.artwork_url AS podcast_artwork_url${rankSelect}
         ${fromSql}
         ORDER BY ${orderBy(sortBy, direction)}
         LIMIT @limit OFFSET @offset`
      )
      .all(params) as SearchRow[]

    const countSql = useFts
      ? `SELECT COUNT(*) AS n
         FROM episode_search s JOIN episodes e ON e.id = s.rowid
         WHERE episode_search MATCH @ftsQuery${whereAnd}`
      : `SELECT COUNT(*) AS n FROM episodes e ${whereSql}`

    const total = (this.db.prepare(countSql).get(params) as { n: number }).n

    return {
      rows: rows.map(toEpisode),
      total,
      hasMore: offset + rows.length < total
    }
  }
}
