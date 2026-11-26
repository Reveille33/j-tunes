import type { Db } from '../connection'
import type { PodcastFolder } from '@shared/types'

/**
 * Extra folders whose files belong to a podcast.
 *
 * These are source locations, not the app download directory. A path belongs
 * to at most one podcast.
 */
export class PodcastFolderRepo {
  constructor(private readonly db: Db) {}

  list(podcastId: number): PodcastFolder[] {
    const rows = this.db
      .prepare(
        `SELECT id, podcast_id, path, created_at
           FROM podcast_folders
          WHERE podcast_id = ?
          ORDER BY id ASC`
      )
      .all(podcastId) as {
      id: number
      podcast_id: number
      path: string
      created_at: number
    }[]
    return rows.map((row) => ({
      id: row.id,
      podcastId: row.podcast_id,
      path: row.path,
      createdAt: row.created_at
    }))
  }

  add(podcastId: number, path: string): PodcastFolder {
    if (!this.db.prepare('SELECT 1 FROM podcasts WHERE id = ?').get(podcastId)) {
      throw new Error('Podcast not found')
    }
    const existing = this.db.prepare('SELECT id FROM podcast_folders WHERE path = ?').get(path) as
      | { id: number }
      | undefined
    if (existing) throw new Error('Folder already added')

    const info = this.db
      .prepare('INSERT INTO podcast_folders (podcast_id, path, created_at) VALUES (?, ?, ?)')
      .run(podcastId, path, Date.now())
    const created = this.list(podcastId).find((folder) => folder.id === Number(info.lastInsertRowid))
    if (!created) throw new Error('Folder not found')
    return created
  }

  remove(folderId: number): void {
    const info = this.db.prepare('DELETE FROM podcast_folders WHERE id = ?').run(folderId)
    if (info.changes === 0) throw new Error('Folder not found')
  }
}
