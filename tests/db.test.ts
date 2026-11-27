import { describe, it, expect, beforeEach } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { MIGRATIONS } from '../src/main/db/migrations'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { SearchRepo, toFtsQuery, yearBounds } from '../src/main/db/repositories/searchRepo'
import { SettingsRepo, DEFAULT_SETTINGS } from '../src/main/db/repositories/settingsRepo'
import type { ParsedEpisode } from '../src/shared/types'

function episode(over: Partial<ParsedEpisode> = {}): ParsedEpisode {
  return {
    guid: 'guid-1',
    title: 'Episode One',
    description: 'A description of the first episode',
    descriptionHtml: '<p>A description of the first episode</p>',
    mediaUrl: 'https://example.com/ep1.mp3',
    mediaType: 'audio/mpeg',
    mediaLength: 1000,
    durationSecs: 1800,
    releaseDate: new Date(2019, 4, 5).getTime(),
    episodeNumber: 1,
    seasonNumber: 1,
    artworkUrl: null,
    ...over
  }
}

describe('database layer', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let search: SearchRepo

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    search = new SearchRepo(db)
  })

  it('creates the schema with FTS5 and all tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    expect(names).toContain('podcasts')
    expect(names).toContain('episodes')
    expect(names).toContain('episode_search')
    expect(names).toContain('settings')
    expect(names).not.toContain('download_queue')
    expect(names).toContain('import_jobs')
  })

  it('drops a leftover download_queue table', () => {
    db.exec('CREATE TABLE download_queue (id INTEGER PRIMARY KEY)')
    const drop = MIGRATIONS.find((migration) => migration.version === '003_drop_download_queue')
    expect(drop).toBeDefined()
    db.exec(drop!.sql)
    const names = (
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]
    ).map((row) => row.name)
    expect(names).not.toContain('download_queue')
  })

  it('creates a podcast and retrieves it', () => {
    const created = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'My Show' })
    expect(created.id).toBeGreaterThan(0)
    expect(podcasts.getById(created.id)?.title).toBe('My Show')
    expect(podcasts.getByFeedUrl('https://example.com/feed.xml')?.id).toBe(created.id)
  })

  it('updates metadata with a partial set of fields', () => {
    const created = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Original' })

    // better-sqlite3 requires every named parameter in a statement to be
    // present, so a partial update must still supply all of them.
    expect(() =>
      podcasts.updateMeta(created.id, { etag: 'W/"abc"', lastModified: 'Mon, 01 Jan 2024' })
    ).not.toThrow()

    const updated = podcasts.getById(created.id)!
    expect(updated.title).toBe('Original')
    expect(updated.author).toBeNull()

    const meta = podcasts.getFeedMeta(created.id)!
    expect(meta.etag).toBe('W/"abc"')
    expect(meta.lastModified).toBe('Mon, 01 Jan 2024')
  })

  it('does not duplicate a podcast for the same feed url', () => {
    podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'One' })
    expect(() =>
      podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Two' })
    ).toThrow()
  })

  it('inserts episodes idempotently (feed re-sync safety)', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    const first = episodes.insertMany(pod.id, [episode()])
    const second = episodes.insertMany(pod.id, [episode()])

    expect(first).toHaveLength(1)
    expect(second).toHaveLength(0)

    const count = db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }
    expect(count.n).toBe(1)
  })

  it('cascades episode deletion when a podcast is removed', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(pod.id, [episode()])
    podcasts.remove(pod.id)

    const count = db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }
    expect(count.n).toBe(0)
  })

  it('searches title, description and filename via FTS5', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Radiolab' })
    episodes.insertMany(pod.id, [
      episode({ guid: 'a', title: 'Colors', description: 'About perception' }),
      episode({ guid: 'b', title: 'Sound', description: 'About listening' })
    ])
    const soundId = (db.prepare('SELECT id FROM episodes WHERE guid = ?').get('b') as { id: number })
      .id
    episodes.attachFile(soundId, 'C:/podcasts/sound.mp3', 100, 100)

    const byTitle = search.query({ filters: { text: 'Colors' } })
    expect(byTitle.total).toBe(1)
    expect(byTitle.rows[0].title).toBe('Colors')

    const byDescription = search.query({ filters: { text: 'listening' } })
    expect(byDescription.total).toBe(1)
    expect(byDescription.rows[0].title).toBe('Sound')

    const byFilename = search.query({ filters: { text: 'sound.mp3' } })
    expect(byFilename.total).toBeGreaterThanOrEqual(1)
  })

  it('filters by the displayed release year', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(pod.id, [
      episode({ guid: 'y2019', releaseDate: new Date(2019, 2, 3).getTime() }),
      episode({ guid: 'y2021', releaseDate: new Date(2021, 6, 9).getTime() })
    ])

    const r2019 = search.query({ filters: { year: 2019 } })
    expect(r2019.total).toBe(1)
    expect(r2019.rows[0].guid).toBe('y2019')

    const r2021 = search.query({ filters: { year: 2021 } })
    expect(r2021.total).toBe(1)
    expect(r2021.rows[0].guid).toBe('y2021')
  })

  it('sorts by title, release date and podcast', () => {
    const a = podcasts.create({ feedUrl: 'https://a.com/f.xml', title: 'Alpha' })
    const b = podcasts.create({ feedUrl: 'https://b.com/f.xml', title: 'Beta' })
    episodes.insertMany(a.id, [episode({ guid: 'z', title: 'Zebra' })])
    episodes.insertMany(b.id, [episode({ guid: 'm', title: 'Mango' })])

    const byTitle = search.query({ sortBy: 'title', direction: 'asc' })
    expect(byTitle.rows.map((r) => r.title)).toEqual(['Mango', 'Zebra'])

    const byPodcast = search.query({ sortBy: 'podcast', direction: 'asc' })
    expect(byPodcast.rows.map((r) => r.podcastTitle)).toEqual(['Alpha', 'Beta'])
  })

  it('filters by played and download state', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(pod.id, [episode({ guid: 'p1' }), episode({ guid: 'p2' })])
    const id = (db.prepare('SELECT id FROM episodes WHERE guid = ?').get('p1') as { id: number })
      .id
    episodes.setPlayed(id, true)

    const played = search.query({ filters: { played: true } })
    expect(played.total).toBe(1)

    const downloaded = search.query({ filters: { downloadState: 'done' } })
    expect(downloaded.total).toBe(0)
  })

  it('paginates results', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(
      pod.id,
      Array.from({ length: 25 }, (_, i) =>
        episode({ guid: `g${i}`, title: `Episode ${i}`, releaseDate: 1000 + i * 1000 })
      )
    )

    const page1 = search.query({ limit: 10, offset: 0, sortBy: 'release_date', direction: 'desc' })
    expect(page1.rows).toHaveLength(10)
    expect(page1.total).toBe(25)
    expect(page1.hasMore).toBe(true)

    const page3 = search.query({ limit: 10, offset: 20, sortBy: 'release_date', direction: 'desc' })
    expect(page3.rows).toHaveLength(5)
    expect(page3.hasMore).toBe(false)
  })

  it('quotes FTS5 user input so special characters are safe', () => {
    expect(toFtsQuery('hello world')).toBe('"hello"* AND "world"*')
    expect(toFtsQuery('a"b')).toBe('"a""b"*')
    expect(toFtsQuery('  ')).toBe('')
  })

  it('computes local-time year bounds', () => {
    const { start, end } = yearBounds(2021)
    expect(new Date(start).getFullYear()).toBe(2021)
    expect(new Date(end).getFullYear()).toBe(2022)
    expect(end).toBeGreaterThan(start)
  })

  it('persists and reads settings with defaults', () => {
    const settings = new SettingsRepo(db)
    expect(settings.getAll().theme).toBe(DEFAULT_SETTINGS.theme)

    settings.set('theme', 'light')
    settings.set('globalDescriptionsVisible', true)
    const all = settings.getAll()
    expect(all.theme).toBe('light')
    expect(all.globalDescriptionsVisible).toBe(true)
    expect(all.showFullDescriptions).toBe(false)

    settings.set('showFullDescriptions', true)
    expect(settings.getAll().showFullDescriptions).toBe(true)
  })

  it('lists distinct years newest first', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(pod.id, [
      episode({ guid: 'a', releaseDate: new Date(2015, 0, 1).getTime() }),
      episode({ guid: 'b', releaseDate: new Date(2020, 0, 1).getTime() }),
      episode({ guid: 'c', releaseDate: new Date(2020, 5, 1).getTime() })
    ])
    const years = episodes.listYears()
    expect(years).toEqual([2020, 2015])
  })

  it('stores and restores playback position', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(pod.id, [episode()])
    const id = (db.prepare('SELECT id FROM episodes').get() as { id: number }).id

    episodes.setPlayPosition(id, 123.5, 1800)
    const row = episodes.getById(id)!
    expect(row.play_position).toBeCloseTo(123.5)
    expect(row.duration_known).toBe(1800)
  })

  it('filters by description text', () => {
    const pod = podcasts.create({ feedUrl: 'https://example.com/f.xml', title: 'Show' })
    episodes.insertMany(pod.id, [
      episode({ guid: 'd1', description: 'A story about deep sea diving' }),
      episode({ guid: 'd2', description: 'A story about baking bread' })
    ])

    const res = search.query({ filters: { descriptionTerm: 'diving' } })
    expect(res.total).toBe(1)
    expect(res.rows[0].guid).toBe('d1')
  })
})

