import type { Db } from '../connection'
import type { PlaylistSummary } from '@shared/types'

/**
 * Named playlists of episodes.
 *
 * Membership is unique per playlist. Adding an episode that is already in the
 * playlist leaves it where it is and reports it as skipped, the same way the
 * Up Next queue ignores an episode that is already queued.
 */
export class PlaylistRepo {
  constructor(private readonly db: Db) {}

  list(): PlaylistSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM playlist_episodes pe WHERE pe.playlist_id = p.id) AS episode_count
           FROM playlists p
          ORDER BY p.created_at ASC, p.id ASC`
      )
      .all() as { id: number; name: string; episode_count: number }[]
    return rows.map(toSummary)
  }

  getById(id: number): PlaylistSummary | null {
    const row = this.db
      .prepare(
        `SELECT p.id, p.name,
                (SELECT COUNT(*) FROM playlist_episodes pe WHERE pe.playlist_id = p.id) AS episode_count
           FROM playlists p
          WHERE p.id = ?`
      )
      .get(id) as { id: number; name: string; episode_count: number } | undefined
    return row ? toSummary(row) : null
  }

  /** Episode ids in playlist order. */
  episodeIds(playlistId: number): number[] {
    const rows = this.db
      .prepare(
        'SELECT episode_id FROM playlist_episodes WHERE playlist_id = ? ORDER BY position ASC, added_at ASC'
      )
      .all(playlistId) as { episode_id: number }[]
    return rows.map((row) => row.episode_id)
  }

  /** Drops one episode from a playlist. Missing membership is a no-op. */
  removeEpisode(playlistId: number, episodeId: number): void {
    if (!this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(playlistId)) {
      throw new Error('Playlist not found')
    }
    this.db
      .prepare('DELETE FROM playlist_episodes WHERE playlist_id = ? AND episode_id = ?')
      .run(playlistId, episodeId)
  }

  create(name: string): PlaylistSummary {
    const result = this.db
      .prepare('INSERT INTO playlists (name, created_at) VALUES (?, ?)')
      .run(name, Date.now())
    const created = this.getById(Number(result.lastInsertRowid))
    if (!created) throw new Error('Playlist not found')
    return created
  }

  /**
   * Appends episodes that are not already members.
   *
   * Unknown episode ids and repeats in `episodeIds` count as skipped. An
   * unknown playlist throws.
   */
  addEpisodes(playlistId: number, episodeIds: number[]): { added: number; skipped: number } {
    if (!this.db.prepare('SELECT 1 FROM playlists WHERE id = ?').get(playlistId)) {
      throw new Error('Playlist not found')
    }

    const episodeExists = this.db.prepare('SELECT 1 FROM episodes WHERE id = ?')
    const member = this.db.prepare(
      'SELECT 1 FROM playlist_episodes WHERE playlist_id = ? AND episode_id = ?'
    )
    const insert = this.db.prepare(
      `INSERT INTO playlist_episodes (playlist_id, episode_id, position, added_at)
       VALUES (?, ?, ?, ?)`
    )
    const nextPosition = this.db.prepare(
      'SELECT COALESCE(MAX(position), 0) AS n FROM playlist_episodes WHERE playlist_id = ?'
    )

    return this.db.transaction((ids: number[]) => {
      let added = 0
      let skipped = 0
      const seen = new Set<number>()
      let position = (nextPosition.get(playlistId) as { n: number }).n
      const now = Date.now()

      for (const episodeId of ids) {
        if (seen.has(episodeId) || !episodeExists.get(episodeId) || member.get(playlistId, episodeId)) {
          skipped += 1
          seen.add(episodeId)
          continue
        }
        seen.add(episodeId)
        position += 1
        insert.run(playlistId, episodeId, position, now)
        added += 1
      }

      return { added, skipped }
    })(episodeIds)
  }
}

function toSummary(row: { id: number; name: string; episode_count: number }): PlaylistSummary {
  return { id: row.id, name: row.name, episodeCount: row.episode_count }
}
