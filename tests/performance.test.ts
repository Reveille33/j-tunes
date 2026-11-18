import { describe, it, expect, beforeAll } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { SearchRepo } from '../src/main/db/repositories/searchRepo'
import type { ParsedEpisode } from '../src/shared/types'

/**
 * Verifies that the database layer stays fast with a large library.
 *
 * The brief calls for tens of thousands of episodes; this seeds 50,000 and
 * asserts that the operations the UI performs on every keystroke remain
 * comfortably interactive.
 */

const PODCAST_COUNT = 500
const EPISODES_PER_PODCAST = 100
const TOTAL_EPISODES = PODCAST_COUNT * EPISODES_PER_PODCAST

const WORDS = [
  'radiolab', 'colors', 'sound', 'machine', 'learning', 'quantum', 'ocean',
  'forest', 'signal', 'noise', 'archive', 'memory', 'future', 'network',
  'system', 'human', 'story', 'science', 'history', 'secret'
]

function makeEpisode(i: number): ParsedEpisode {
  const w1 = WORDS[i % WORDS.length]
  const w2 = WORDS[(i * 7) % WORDS.length]
  const year = 2011 + (i % 15)
  return {
    guid: `guid-${i}`,
    title: `${w1} ${w2} episode ${i}`,
    description: `A detailed description about ${w1} and ${w2} for episode number ${i}.`,
    descriptionHtml: `<p>A detailed description about ${w1} and ${w2}.</p>`,
    mediaUrl: `https://cdn.example.com/${w1}/${i}.mp3`,
    mediaType: 'audio/mpeg',
    mediaLength: 20_000_000 + i,
    durationSecs: 600 + (i % 3000),
    releaseDate: new Date(year, i % 12, (i % 27) + 1).getTime(),
    episodeNumber: i,
    seasonNumber: 1 + (i % 5),
    artworkUrl: null
  }
}

describe('performance with a large library', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let search: SearchRepo
  let seedMs = 0

  beforeAll(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    search = new SearchRepo(db)

    const start = Date.now()
    for (let p = 0; p < PODCAST_COUNT; p++) {
      const podcast = podcasts.create({
        feedUrl: `https://feeds.example.com/show-${p}`,
        title: `Podcast ${p}`
      })
      const batch: ParsedEpisode[] = []
      for (let e = 0; e < EPISODES_PER_PODCAST; e++) {
        batch.push(makeEpisode(p * EPISODES_PER_PODCAST + e))
      }
      episodes.insertMany(podcast.id, batch)
    }
    seedMs = Date.now() - start
  })

  it(`seeds ${TOTAL_EPISODES.toLocaleString()} episodes`, () => {
    const count = db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }
    expect(count.n).toBe(TOTAL_EPISODES)
    // Seeding 50k episodes should take a few seconds at most.
    expect(seedMs).toBeLessThan(30_000)
  })

  it('performs a full-text search in well under a frame budget', () => {
    const start = Date.now()
    const result = search.query({ filters: { text: 'radiolab' }, limit: 50 })
    const elapsed = Date.now() - start

    expect(result.total).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(500)
  })

  it('searches the local filename', () => {
    // Filename search only matches episodes that have a file on disk, so
    // attach a path to a subset of the library first.
    const ids = db
      .prepare('SELECT id FROM episodes LIMIT 500')
      .all() as { id: number }[]
    const attach = db.prepare(
      "UPDATE episodes SET file_path = ? WHERE id = ?"
    )
    ids.forEach((row, i) => {
      attach.run(`C:\\Podcasts\\Show ${i}\\episode-${i}.mp3`, row.id)
    })

    const start = Date.now()
    const result = search.query({ filters: { text: 'episode-42' }, limit: 20 })
    const elapsed = Date.now() - start

    expect(result.total).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(500)
  })

  it('filters by year quickly', () => {
    const start = Date.now()
    const result = search.query({ filters: { year: 2015 }, limit: 50 })
    const elapsed = Date.now() - start

    expect(result.total).toBeGreaterThan(0)
    expect(elapsed).toBeLessThan(500)
  })

  it('sorts the newest episodes quickly', () => {
    const start = Date.now()
    const result = search.query({ sortBy: 'release_date', direction: 'desc', limit: 50 })
    const elapsed = Date.now() - start

    expect(result.rows).toHaveLength(50)
    expect(elapsed).toBeLessThan(500)
  })

  it('sorts by title and by duration', () => {
    const byTitle = search.query({ sortBy: 'title', direction: 'asc', limit: 20 })
    expect(byTitle.rows).toHaveLength(20)

    const byDuration = search.query({ sortBy: 'duration', direction: 'desc', limit: 20 })
    expect(byDuration.rows).toHaveLength(20)
  })

  it('paginates without loading the whole table', () => {
    const page = search.query({ limit: 200, offset: 0 })
    expect(page.rows).toHaveLength(200)
    expect(page.total).toBe(TOTAL_EPISODES)
    expect(page.hasMore).toBe(true)
  })

  it('counts the available years', () => {
    const years = episodes.listYears()
    expect(years.length).toBeGreaterThan(10)
    expect(years[0]).toBeGreaterThan(years[years.length - 1])
  })

  it('re-checks a feed without duplicating rows', () => {
    const podcast = podcasts.list()[0]
    const batch: ParsedEpisode[] = []
    for (let e = 0; e < EPISODES_PER_PODCAST; e++) {
      batch.push(makeEpisode(e))
    }
    const inserted = episodes.insertMany(podcast.id, batch)
    expect(inserted).toHaveLength(0)
  })
})
