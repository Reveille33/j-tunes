import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { fetchFeed } from '../src/main/services/feedService'
import { UpdateService } from '../src/main/services/updateService'
import type { UpdateProgress } from '../src/shared/types'

vi.mock('../src/main/services/feedService', () => ({
  fetchFeed: vi.fn()
}))

describe('feed refresh errors', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    vi.mocked(fetchFeed).mockReset()
  })

  it('stores the error and does not report a successful empty check', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    vi.mocked(fetchFeed).mockRejectedValue(new Error('Feed request failed'))
    const progress: UpdateProgress[] = []

    const outcome = await new UpdateService({
      podcasts,
      episodes,
      onProgress: (value) => progress.push(value)
    }).check(podcast.id)

    const stored = podcasts.getById(podcast.id)!
    expect(stored.lastError).toBe('Feed request failed')
    expect(stored.lastCheckedAt).toBeNull()
    expect(outcome.errors).toBe(1)
    expect(outcome.added).toBe(0)
    expect(progress.some((event) => event.status === 'done')).toBe(false)
    expect(progress.some((event) => event.status === 'error')).toBe(true)
  })

  it('clears the error after a successful refresh', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    podcasts.setLastError(podcast.id, 'Feed request failed')
    vi.mocked(fetchFeed).mockResolvedValue({
      notModified: false,
      etag: null,
      lastModified: null,
      feed: {
        title: 'Show',
        author: null,
        description: null,
        descriptionHtml: null,
        artworkUrl: null,
        category: null,
        language: null,
        link: null,
        episodes: []
      }
    })

    await new UpdateService({ podcasts, episodes }).check(podcast.id)

    const stored = podcasts.getById(podcast.id)!
    expect(stored.lastError).toBeNull()
    expect(stored.lastCheckedAt).not.toBeNull()
  })
})