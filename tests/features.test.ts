import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { ChapterRepo } from '../src/main/db/repositories/chapterRepo'
import { QueueRepo } from '../src/main/db/repositories/queueRepo'
import { StatsRepo } from '../src/main/db/repositories/statsRepo'
import { SearchRepo } from '../src/main/db/repositories/searchRepo'
import { SettingsRepo, DEFAULT_SETTINGS } from '../src/main/db/repositories/settingsRepo'
import { fetchFeed } from '../src/main/services/feedService'
import { UpdateService } from '../src/main/services/updateService'
import type { ParsedEpisode } from '../src/shared/types'

vi.mock('../src/main/services/feedService', () => ({
  fetchFeed: vi.fn()
}))

function ep(over: Partial<ParsedEpisode> = {}): ParsedEpisode {
  return {
    guid: 'g1',
    title: 'Episode',
    description: 'desc',
    descriptionHtml: '<p>desc</p>',
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

describe('queue, chapters, stats and bulk actions', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let chapters: ChapterRepo
  let queue: QueueRepo
  let stats: StatsRepo
  let search: SearchRepo

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    chapters = new ChapterRepo(db)
    queue = new QueueRepo(db)
    stats = new StatsRepo(db)
    search = new SearchRepo(db)
  })

  function seed(): { podcastId: number; ids: number[] } {
    const podcast = podcasts.create({ feedUrl: 'https://x/feed.xml', title: 'Show' })
    const ids = episodes.insertMany(podcast.id, [
      ep({ guid: 'a', title: 'A', releaseDate: new Date(2024, 0, 3).getTime() }),
      ep({ guid: 'b', title: 'B', releaseDate: new Date(2024, 0, 2).getTime() }),
      ep({ guid: 'c', title: 'C', releaseDate: new Date(2024, 0, 1).getTime() })
    ])
    return { podcastId: podcast.id, ids }
  }

  function playedCount(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM episodes WHERE played = 1').get() as {
      n: number
    }).n
  }

  it('persists a chapters URL from the feed', () => {
    const podcast = podcasts.create({ feedUrl: 'https://x/f.xml', title: 'S' })
    const [id] = episodes.insertMany(podcast.id, [
      ep({ guid: 'z', chaptersUrl: 'https://x/chapters.json' })
    ])
    expect(episodes.getChaptersUrl(id)).toBe('https://x/chapters.json')
  })

  it('stores chapters in start order and replaces them atomically', () => {
    const { ids } = seed()
    chapters.replaceForEpisode(ids[0], [
      { startSecs: 120, title: 'Second' },
      { startSecs: 0, title: 'First' }
    ])
    expect(chapters.list(ids[0]).map((c) => c.title)).toEqual(['First', 'Second'])

    chapters.replaceForEpisode(ids[0], [{ startSecs: 5, title: 'Only' }])
    expect(chapters.list(ids[0])).toHaveLength(1)
    expect(chapters.count(ids[0])).toBe(1)
  })

  it('maintains queue order and shifts the head', () => {
    const { ids } = seed()
    queue.add(ids[0])
    queue.add(ids[1])
    queue.add(ids[2])
    expect(queue.ids()).toEqual([ids[0], ids[1], ids[2]])

    queue.reorder([ids[2], ids[0], ids[1]])
    expect(queue.ids()).toEqual([ids[2], ids[0], ids[1]])

    expect(queue.shift()).toBe(ids[2])
    expect(queue.ids()).toEqual([ids[0], ids[1]])

    queue.remove(ids[0])
    expect(queue.ids()).toEqual([ids[1]])

    queue.add(ids[0])
    queue.clear()
    expect(queue.ids()).toEqual([])
  })

  it('does not enqueue the same episode twice', () => {
    const { ids } = seed()
    queue.add(ids[0])
    queue.add(ids[0])
    expect(queue.ids()).toEqual([ids[0]])
  })

  it('cascades queue rows away with the episode', () => {
    const { ids } = seed()
    queue.add(ids[0])
    db.prepare('DELETE FROM episodes WHERE id = ?').run(ids[0])
    expect(queue.ids()).toEqual([])
  })

  it('accumulates listening seconds and reports a streak', () => {
    stats.addListeningSeconds(30)
    stats.addListeningSeconds(90)
    stats.addListeningSeconds(0)
    stats.addListeningSeconds(-5)

    const summary = stats.summary()
    expect(summary.totalListeningSeconds).toBe(120)
    expect(summary.daysListened).toBe(1)
    expect(summary.currentStreak).toBe(1)
    expect(summary.recentDays).toHaveLength(14)
    expect(summary.recentDays[13].seconds).toBe(120)
  })

  it('summarises library totals', () => {
    const { ids } = seed()
    episodes.setPlayed(ids[0], true)
    db.prepare("UPDATE episodes SET download_state = 'done', file_size = 4096 WHERE id = ?").run(
      ids[0]
    )

    const summary = stats.summary()
    expect(summary.totalEpisodes).toBe(3)
    expect(summary.playedEpisodes).toBe(1)
    expect(summary.downloadedEpisodes).toBe(1)
    expect(summary.downloadedBytes).toBe(4096)
    expect(summary.byPodcast[0].total).toBe(3)
    expect(summary.byPodcast[0].played).toBe(1)
    expect(summary.byPodcast[0].seconds).toBe(600)

    // Even when all episodes are played, podcast duration is still reported accurately
    episodes.setPlayedMany(ids, true)
    const allPlayedSummary = stats.summary()
    expect(allPlayedSummary.byPodcast[0].played).toBe(3)
    expect(allPlayedSummary.byPodcast[0].seconds).toBe(1800)
  })

  it('marks many episodes played and unplayed', () => {
    const { ids } = seed()
    episodes.setPlayedMany(ids, true)
    expect(playedCount()).toBe(3)
    episodes.setPlayedMany(ids, false)
    expect(playedCount()).toBe(0)
  })

  it('marks a podcast played, optionally only the unplayed ones', () => {
    const { podcastId, ids } = seed()
    episodes.setPlayed(ids[0], true)
    episodes.setPlayedForPodcast(podcastId, true, true)
    expect(playedCount()).toBe(3)

    episodes.setPlayedForPodcast(podcastId, false, false)
    expect(playedCount()).toBe(0)
  })

  it('chooses the next older unplayed episode, wrapping when needed', () => {
    const { podcastId, ids } = seed()
    const [a, b, c] = ids
    const releaseOf = (id: number): number | null => episodes.getById(id)?.release_date ?? null

    // After B, the next older unplayed episode is C.
    expect(episodes.nextUnplayedAfter(releaseOf(b), b, podcastId)).toBe(c)

    // With C played there is no older unplayed one, so it wraps to A.
    episodes.setPlayed(c, true)
    expect(episodes.nextUnplayedAfter(releaseOf(b), b, podcastId)).toBe(a)

    // Nothing unplayed at all.
    episodes.setPlayedMany(ids, true)
    expect(episodes.nextUnplayedAfter(releaseOf(b), b, podcastId)).toBeNull()
  })

  it('lists partially played episodes for Continue Listening', () => {
    const { ids } = seed()
    episodes.setPlayPosition(ids[0], 300, 600)
    episodes.setPlayPosition(ids[1], 5, 600) // below the 10 second threshold
    episodes.setPlayed(ids[2], true) // played episodes are excluded
    episodes.setPlayPosition(ids[2], 300, 600)

    const list = search.listInProgress(8)
    expect(list.map((episode) => episode.id)).toEqual([ids[0]])
    expect(list[0].podcastTitle).toBe('Show')
  })

  it('refreshes a changed enclosure without touching play or download state', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/show.xml', title: 'Show' })
    const [id] = episodes.insertMany(podcast.id, [
      ep({
        guid: 'ep-1',
        title: 'Old Title',
        mediaUrl: 'https://cdn.example/old.mp3',
        mediaType: 'audio/mpeg',
        durationSecs: 100
      })
    ])
    episodes.setFilePath(id, '/downloads/old.mp3', 5000)
    episodes.setDownloadState(id, 'done')
    episodes.setPlayPosition(id, 42, 100)

    vi.mocked(fetchFeed).mockResolvedValue({
      notModified: false,
      etag: 'v2',
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
        episodes: [
          ep({
            guid: 'ep-1',
            title: 'New Title',
            mediaUrl: 'https://cdn.example/new.mp3',
            mediaType: 'audio/mp4',
            durationSecs: 222
          })
        ]
      }
    })

    const outcome = await new UpdateService({ podcasts, episodes }).check(podcast.id)

    expect(outcome.added).toBe(0)
    expect(outcome.errors).toBe(0)
    const row = episodes.getById(id)!
    expect(row.title).toBe('New Title')
    expect(row.media_url).toBe('https://cdn.example/new.mp3')
    expect(row.media_type).toBe('audio/mp4')
    expect(row.duration_secs).toBe(222)
    expect(row.play_position).toBe(42)
    expect(row.download_state).toBe('done')
    expect(row.file_path).toBe('/downloads/old.mp3')
    expect(row.file_size).toBe(5000)
    expect(row.played).toBe(0)
  })

  it('defaults the new notification setting to on', () => {
    const settings = new SettingsRepo(db)
    expect(settings.getAll(DEFAULT_SETTINGS).notifyOnNewEpisodes).toBe(true)
    settings.set('notifyOnNewEpisodes', false)
    expect(settings.getAll(DEFAULT_SETTINGS).notifyOnNewEpisodes).toBe(false)
  })
})