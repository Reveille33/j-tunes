import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { QueueRepo } from '../src/main/db/repositories/queueRepo'
import { SearchRepo } from '../src/main/db/repositories/searchRepo'
import { PlaybackService } from '../src/main/services/playbackService'
import type { ParsedEpisode } from '../src/shared/types'

function ep(over: Partial<ParsedEpisode>): ParsedEpisode {
  return {
    guid: 'g',
    title: 'Episode',
    description: null,
    descriptionHtml: null,
    mediaUrl: 'https://example.com/e.mp3',
    mediaType: 'audio/mpeg',
    mediaLength: 100,
    durationSecs: 600,
    releaseDate: new Date(2024, 0, 1).getTime(),
    episodeNumber: null,
    seasonNumber: null,
    artworkUrl: null,
    ...over
  }
}

describe('continuous playback', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let queue: QueueRepo
  let search: SearchRepo
  let playback: PlaybackService

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    queue = new QueueRepo(db)
    search = new SearchRepo(db)
    playback = new PlaybackService({ queue, episodes, search })
  })

  /** Three episodes, newest first: A, B, C. */
  function seed(): { ids: number[] } {
    const podcast = podcasts.create({ feedUrl: 'https://x/f.xml', title: 'Show' })
    const ids = episodes.insertMany(podcast.id, [
      ep({ guid: 'a', title: 'A', releaseDate: new Date(2024, 0, 3).getTime() }),
      ep({ guid: 'b', title: 'B', releaseDate: new Date(2024, 0, 2).getTime() }),
      ep({ guid: 'c', title: 'C', releaseDate: new Date(2024, 0, 1).getTime() })
    ])
    return { ids }
  }

  it('prefers the head of the Up Next queue and consumes it', () => {
    const { ids } = seed()
    const [a, b, c] = ids
    queue.add(c)

    const next = playback.next(b)
    expect(next?.id).toBe(c)
    expect(queue.ids()).toEqual([])
    expect(next?.podcastTitle).toBe('Show')
    expect(a).toBeGreaterThan(0)
  })

  it('skips the current episode when it sits at the head of the queue', () => {
    const { ids } = seed()
    const [, b, c] = ids
    queue.add(b)
    queue.add(c)

    expect(playback.next(b)?.id).toBe(c)
  })

  it('falls back to the next unplayed episode when the queue is empty', () => {
    const { ids } = seed()
    const [, b, c] = ids
    expect(playback.next(b)?.id).toBe(c)
  })

  it('returns null when nothing is left to play', () => {
    const { ids } = seed()
    const [a] = ids
    episodes.setPlayedMany(ids, true)
    expect(playback.next(a)).toBeNull()
  })
})