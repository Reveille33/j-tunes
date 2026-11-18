import type { Db } from '../connection'
import type { LibraryStats, PodcastStat, StorageSummary } from '@shared/types'

/** Formats a date as a local-timezone `YYYY-MM-DD` key. */
function dayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Listening statistics.
 *
 * Time is accumulated as playback advances (see `player:savePosition`), which
 * makes "hours listened" far more meaningful than counting finished episodes
 * alone. Everything else is derived from the episode table on demand.
 */
export class StatsRepo {
  constructor(private readonly db: Db) {}

  /** Adds actively-listened seconds to today's total. */
  addListeningSeconds(seconds: number): void {
    const delta = Math.round(seconds)
    if (!Number.isFinite(delta) || delta <= 0) return
    this.db
      .prepare(
        `INSERT INTO listening_stats (day, seconds) VALUES (?, ?)
         ON CONFLICT(day) DO UPDATE SET seconds = seconds + excluded.seconds`
      )
      .run(dayKey(new Date()), delta)
  }

  /** Disk usage of downloaded episodes, grouped by podcast. */
  storageSummary(): StorageSummary {
    const rows = this.db
      .prepare(
        `SELECT p.id AS podcast_id, p.title,
                COUNT(e.id) AS episodes,
                COALESCE(SUM(e.file_size), 0) AS bytes
         FROM podcasts p
         JOIN episodes e ON e.podcast_id = p.id AND e.download_state = 'done'
         GROUP BY p.id
         ORDER BY bytes DESC`
      )
      .all() as { podcast_id: number; title: string; episodes: number; bytes: number }[]

    const byPodcast = rows.map((r) => ({
      podcastId: r.podcast_id,
      title: r.title,
      episodes: r.episodes,
      bytes: r.bytes
    }))

    return {
      totalEpisodes: byPodcast.reduce((sum, p) => sum + p.episodes, 0),
      totalBytes: byPodcast.reduce((sum, p) => sum + p.bytes, 0),
      byPodcast
    }
  }

  summary(): LibraryStats {
    const totals = this.db
      .prepare(
        `SELECT
           COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN played = 1 THEN 1 ELSE 0 END), 0) AS played,
           COALESCE(SUM(CASE WHEN download_state = 'done' THEN 1 ELSE 0 END), 0) AS downloaded,
           COALESCE(SUM(CASE WHEN download_state = 'done' THEN file_size ELSE 0 END), 0) AS bytes
         FROM episodes`
      )
      .get() as { total: number; played: number; downloaded: number; bytes: number }

    const listening = this.db
      .prepare('SELECT COALESCE(SUM(seconds), 0) AS total, COUNT(*) AS days FROM listening_stats')
      .get() as { total: number; days: number }

    const byPodcastRows = this.db
      .prepare(
        `SELECT p.id AS podcast_id, p.title,
                COUNT(e.id) AS total,
                COALESCE(SUM(CASE WHEN e.played = 1 THEN 1 ELSE 0 END), 0) AS played,
                COALESCE(SUM(CASE WHEN e.played = 1 THEN COALESCE(e.duration_known, e.duration_secs, 0) ELSE e.play_position END), 0) AS seconds
         FROM podcasts p
         LEFT JOIN episodes e ON e.podcast_id = p.id
         GROUP BY p.id
         ORDER BY seconds DESC, played DESC, p.title COLLATE NOCASE ASC
         LIMIT 50`
      )
      .all() as {
      podcast_id: number
      title: string
      total: number
      played: number
      seconds: number
    }[]

    const byPodcast: PodcastStat[] = byPodcastRows.map((r) => ({
      podcastId: r.podcast_id,
      title: r.title,
      played: r.played,
      total: r.total,
      seconds: Math.round(r.seconds)
    }))

    const allDays = new Set(
      (
        this.db.prepare('SELECT day FROM listening_stats WHERE seconds > 0').all() as {
          day: string
        }[]
      ).map((r) => r.day)
    )

    // Consecutive days ending today (or yesterday, so a streak survives a
    // late-night gap before the next listen).
    let currentStreak = 0
    const cursor = new Date()
    if (!allDays.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1)
    while (allDays.has(dayKey(cursor))) {
      currentStreak += 1
      cursor.setDate(cursor.getDate() - 1)
    }

    // The last 14 days, oldest first, with zero-filled gaps.
    const since = new Date()
    since.setDate(since.getDate() - 13)
    const recentRows = this.db
      .prepare('SELECT day, seconds FROM listening_stats WHERE day >= ?')
      .all(dayKey(since)) as { day: string; seconds: number }[]
    const recentMap = new Map(recentRows.map((r) => [r.day, r.seconds]))
    const recentDays: { day: string; seconds: number }[] = []
    for (let i = 13; i >= 0; i -= 1) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const key = dayKey(d)
      recentDays.push({ day: key, seconds: recentMap.get(key) ?? 0 })
    }

    return {
      totalEpisodes: totals.total,
      playedEpisodes: totals.played,
      downloadedEpisodes: totals.downloaded,
      downloadedBytes: totals.bytes,
      totalListeningSeconds: listening.total,
      daysListened: listening.days,
      currentStreak,
      byPodcast,
      recentDays
    }
  }
}