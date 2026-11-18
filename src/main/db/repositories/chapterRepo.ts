import type { Db } from '../connection'
import type { Chapter } from '@shared/types'

/**
 * Chapter markers for episodes.
 *
 * Chapters come from a Podcast 2.0 chapters document referenced by the feed;
 * they are fetched lazily the first time a player asks for them.
 */
export class ChapterRepo {
  constructor(private readonly db: Db) {}

  /** Replaces every chapter for an episode atomically. */
  replaceForEpisode(episodeId: number, chapters: { startSecs: number; title: string }[]): void {
    const del = this.db.prepare('DELETE FROM chapters WHERE episode_id = ?')
    const ins = this.db.prepare(
      'INSERT OR IGNORE INTO chapters (episode_id, start_secs, title) VALUES (?, ?, ?)'
    )
    const run = this.db.transaction((list: { startSecs: number; title: string }[]) => {
      del.run(episodeId)
      for (const c of list) ins.run(episodeId, c.startSecs, c.title)
    })
    run(chapters)
  }

  list(episodeId: number): Chapter[] {
    const rows = this.db
      .prepare(
        `SELECT id, episode_id, start_secs, title
         FROM chapters WHERE episode_id = ?
         ORDER BY start_secs ASC`
      )
      .all(episodeId) as {
      id: number
      episode_id: number
      start_secs: number
      title: string
    }[]
    return rows.map((r) => ({
      id: r.id,
      episodeId: r.episode_id,
      startSecs: r.start_secs,
      title: r.title
    }))
  }

  count(episodeId: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM chapters WHERE episode_id = ?')
      .get(episodeId) as { n: number }
    return row.n
  }
}