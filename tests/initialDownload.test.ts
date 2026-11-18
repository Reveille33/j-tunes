import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { queueNewestSubscribedEpisode } from '../src/main/services/initialDownload'
import { OpmlImportService } from '../src/main/services/opmlImportService'
import { subscribeToFeed } from '../src/main/services/subscriptionService'

function item(guid: string, title: string, pubDate: string): string {
  return `<item>
    <title>${title}</title>
    <guid>${guid}</guid>
    <pubDate>${pubDate}</pubDate>
    <enclosure url="https://cdn.example/${guid}.mp3" type="audio/mpeg" length="1" />
  </item>`
}

/** Four episodes. Two share the newest date; the later row (higher id) wins. */
function catalog(title: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>${title}</title>
  ${item('old', 'Old', 'Wed, 01 Jan 2020 00:00:00 GMT')}
  ${item('tie-early', 'Tie early', 'Mon, 01 Jan 2024 00:00:00 GMT')}
  ${item('middle', 'Middle', 'Sat, 01 Jan 2022 00:00:00 GMT')}
  ${item('tie-late', 'Tie late', 'Mon, 01 Jan 2024 00:00:00 GMT')}
</channel></rss>`
}

describe('initial auto-download', () => {
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

  function stubFeed(xmlFor: (url: string) => string): void {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => new Response(xmlFor(String(input)), { status: 200 }))
    )
  }

  async function subscribe(feedUrl: string) {
    return subscribeToFeed({ podcasts, episodes }, feedUrl)
  }

  it('enqueues only the newest episode when auto-download is on', async () => {
    stubFeed(() => catalog('Show'))
    const subscribed = await subscribe('https://show.example/feed')
    const queued: number[] = []

    queueNewestSubscribedEpisode({
      podcast: subscribed.podcast,
      autoDownloadDefault: true,
      episodeIds: subscribed.newEpisodeIds,
      episodes,
      enqueue: (id) => queued.push(id)
    })

    expect(subscribed.newEpisodeIds).toHaveLength(4)
    expect(queued).toHaveLength(1)
    expect(episodes.getById(queued[0])?.guid).toBe('tie-late')
    expect(subscribed.podcast.autoDownload).toBe(true)
  })

  it('enqueues nothing when auto-download is off', async () => {
    stubFeed(() => catalog('Show'))
    const subscribed = await subscribe('https://show.example/feed')
    const queued: number[] = []

    queueNewestSubscribedEpisode({
      podcast: subscribed.podcast,
      autoDownloadDefault: false,
      episodeIds: subscribed.newEpisodeIds,
      episodes,
      enqueue: (id) => queued.push(id)
    })

    const turnedOff = podcasts.getById(subscribed.podcast.id)!
    podcasts.setAutoDownload(turnedOff.id, false)
    queueNewestSubscribedEpisode({
      podcast: podcasts.getById(turnedOff.id)!,
      autoDownloadDefault: true,
      episodeIds: subscribed.newEpisodeIds,
      episodes,
      enqueue: (id) => queued.push(id)
    })

    expect(queued).toEqual([])
  })

  it('follows the same rule for an OPML import', async () => {
    stubFeed((url) => catalog(url.includes('other') ? 'Other' : 'Show'))
    const queued: number[] = []
    const importer = new OpmlImportService({
      podcasts,
      episodes,
      initialDownload: {
        autoDownloadDefault: () => true,
        enqueue: (id) => queued.push(id)
      }
    })

    const summary = await importer.import([
      { title: 'Show', xmlUrl: 'https://show.example/feed' },
      { title: 'Other', xmlUrl: 'https://other.example/feed' }
    ])

    expect(summary.added).toBe(2)
    expect(queued).toHaveLength(2)
    expect(queued.map((id) => episodes.getById(id)?.guid)).toEqual(['tie-late', 'tie-late'])

    const show = podcasts.getByFeedUrl('https://show.example/feed')!
    expect(episodes.listForPodcast(show.id)).toHaveLength(4)

    const off: number[] = []
    const quiet = new OpmlImportService({
      podcasts,
      episodes,
      initialDownload: {
        autoDownloadDefault: () => false,
        enqueue: (id) => off.push(id)
      }
    })
    const second = await quiet.import([{ title: 'Third', xmlUrl: 'https://third.example/feed' }])
    expect(second.added).toBe(1)
    expect(off).toEqual([])
  })
})
