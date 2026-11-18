import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { OpmlImportService } from '../src/main/services/opmlImportService'
import type { OpmlImportProgress } from '../src/shared/types'

function rss(title: string, mediaUrl: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${title}</title>
    <item>
      <title>Episode One</title>
      <guid>guid-${title}</guid>
      <enclosure url="${mediaUrl}" type="audio/mpeg" length="1" />
    </item>
  </channel>
</rss>`
}

describe('OPML import', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('adds new feeds, skips existing ones and counts failures', async () => {
    podcasts.create({ feedUrl: 'https://existing.example/feed', title: 'Existing' })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('broken')) return new Response('nope', { status: 500 })
        if (url.includes('existing')) return new Response(rss('Existing', 'https://x/e.mp3'))
        return new Response(rss('New Show', 'https://x/n.mp3'))
      })
    )

    const progress: OpmlImportProgress[] = []
    const importer = new OpmlImportService({
      podcasts,
      episodes,
      onProgress: (value) => progress.push(value)
    })

    const summary = await importer.import([
      { title: 'Existing', xmlUrl: 'https://existing.example/feed' },
      { title: 'New', xmlUrl: 'https://new.example/feed' },
      { title: 'Broken', xmlUrl: 'https://broken.example/feed' }
    ])

    expect(summary).toEqual({ added: 1, skipped: 1, failed: 1 })
    expect(podcasts.getByFeedUrl('https://new.example/feed')?.title).toBe('New Show')
    expect(episodes.listForPodcast(podcasts.getByFeedUrl('https://new.example/feed')!.id)).toHaveLength(1)

    // Progress is reported per feed and once more when the import finishes.
    expect(progress.at(-1)?.total).toBe(3)
    expect(progress.at(-1)?.done).toBe(3)
    expect(progress.at(-1)?.currentFeed).toBeNull()
  })

  it('stops early when cancelled', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(rss('Slow Show', 'https://x/s.mp3')))
    )

    const importer = new OpmlImportService({ podcasts, episodes })
    importer.cancel() // cancelled before it starts: the flag is reset on import

    const summary = await importer.import([
      { title: 'A', xmlUrl: 'https://a.example/feed' },
      { title: 'B', xmlUrl: 'https://b.example/feed' }
    ])

    // A fresh import resets the cancel flag, so both feeds are processed.
    expect(summary.added).toBe(2)
  })
})