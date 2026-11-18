import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { QueueRepo } from '../db/repositories/queueRepo'
import type { SearchRepo } from '../db/repositories/searchRepo'
import type { Episode } from '@shared/types'

export interface PlaybackDeps {
  queue: QueueRepo
  episodes: EpisodeRepo
  search: SearchRepo
}

/**
 * Decides which episode plays next when the current one ends.
 *
 * The explicit "Up Next" queue always wins; otherwise playback continues with
 * the next unplayed episode of the same podcast (newest-first, wrapping once).
 * The decision lives here rather than in the IPC handler so it can be tested
 * without spinning up Electron.
 */
export class PlaybackService {
  constructor(private readonly deps: PlaybackDeps) {}

  /** Advances the queue (consuming its head) and returns the next episode. */
  next(currentEpisodeId: number): Episode | null {
    let head = this.deps.queue.shift()
    while (head !== null && head === currentEpisodeId) head = this.deps.queue.shift()
    if (head !== null) return this.deps.search.listByIds([head])[0] ?? null

    const current = this.deps.episodes.getById(currentEpisodeId)
    if (!current) return null

    const nextId = this.deps.episodes.nextUnplayedAfter(
      current.release_date,
      currentEpisodeId,
      current.podcast_id
    )
    if (nextId === null) return null
    return this.deps.search.listByIds([nextId])[0] ?? null
  }
}