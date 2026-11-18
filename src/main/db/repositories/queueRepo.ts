import type { Db } from '../connection'

/**
 * The "Up Next" play queue.
 *
 * Episodes are ordered by a user-controlled dense position. The table is kept
 * intentionally small - it holds episode ids only, and cascades away with the
 * episode.
 */
export class QueueRepo {
  constructor(private readonly db: Db) {}

  /** Ordered episode ids currently in the queue. */
  ids(): number[] {
    const rows = this.db
      .prepare('SELECT episode_id FROM play_queue ORDER BY position ASC, added_at ASC')
      .all() as { episode_id: number }[]
    return rows.map((r) => r.episode_id)
  }

  /** Appends an episode to the end of the queue (no-op if already queued). */
  add(episodeId: number): void {
    const next = this.db
      .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS n FROM play_queue')
      .get() as { n: number }
    this.db
      .prepare('INSERT OR IGNORE INTO play_queue (episode_id, position, added_at) VALUES (?, ?, ?)')
      .run(episodeId, next.n, Date.now())
  }

  addMany(episodeIds: number[]): void {
    const run = this.db.transaction((list: number[]) => {
      for (const id of list) this.add(id)
    })
    run(episodeIds)
  }

  remove(episodeId: number): void {
    this.db.prepare('DELETE FROM play_queue WHERE episode_id = ?').run(episodeId)
  }

  clear(): void {
    this.db.prepare('DELETE FROM play_queue').run()
  }

  /** Rewrites the order to match the given id list. */
  reorder(episodeIds: number[]): void {
    const update = this.db.prepare('UPDATE play_queue SET position = ? WHERE episode_id = ?')
    const run = this.db.transaction((list: number[]) => {
      list.forEach((id, index) => update.run(index + 1, id))
    })
    run(episodeIds)
  }

  /** Removes and returns the head of the queue, or null when empty. */
  shift(): number | null {
    const row = this.db
      .prepare('SELECT episode_id FROM play_queue ORDER BY position ASC, added_at ASC LIMIT 1')
      .get() as { episode_id: number } | undefined
    if (!row) return null
    this.db.prepare('DELETE FROM play_queue WHERE episode_id = ?').run(row.episode_id)
    return row.episode_id
  }
}