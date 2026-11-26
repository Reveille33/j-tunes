import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpathSync } from 'node:fs'
import Database from 'better-sqlite3'
import { runMigrations, createInMemoryDb, type Db } from '../src/main/db/connection'
import { MIGRATIONS } from '../src/main/db/migrations'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { PodcastFolderRepo } from '../src/main/db/repositories/podcastFolderRepo'
import { scanPodcastFolders } from '../src/main/services/folderScan'
import { unsubscribeTrashPlan } from '../src/main/services/sourceFolders'
import { UpdateService } from '../src/main/services/updateService'
import { fetchFeed } from '../src/main/services/feedService'
import {
  podcastFolderAddSchema,
  podcastFolderRemoveSchema,
  podcastFoldersListSchema
} from '../src/shared/validation'
import type { ParsedEpisode } from '../src/shared/types'

vi.mock('../src/main/services/feedService', () => ({
  fetchFeed: vi.fn()
}))

function episode(over: Partial<ParsedEpisode> = {}): ParsedEpisode {
  return {
    guid: 'ep-1',
    title: 'Hello There',
    description: null,
    descriptionHtml: null,
    mediaUrl: 'https://example.com/ep.mp3',
    mediaType: 'audio/mpeg',
    mediaLength: 10,
    durationSecs: 60,
    releaseDate: 1,
    episodeNumber: null,
    seasonNumber: null,
    artworkUrl: null,
    ...over
  }
}

describe('podcast folder migration', () => {
  it('keeps existing podcast and episode rows when feed_url becomes nullable', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      )
    `)
    const record = db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
    for (const migration of MIGRATIONS) {
      if (migration.version >= '006_podcast_folders') break
      db.exec(migration.sql)
      record.run(migration.version, 1)
    }

    const show = db
      .prepare(
        `INSERT INTO podcasts (
           feed_url, title, author, description, description_html, artwork_url, category,
           language, link, etag, last_modified, last_checked_at, last_episode_at,
           episode_count, subscribed_at, auto_download, is_active, sort_order, last_error
         ) VALUES (
           'https://example.com/feed.xml', 'Show', 'Author', 'desc', '<p>desc</p>', 'http://art',
           'Arts', 'en', 'https://example.com', 'etag-1', 'Mon', 111, 222,
           3, 333, 0, 1, 4, 'previous error'
         )`
      )
      .run()
    const imported = db
      .prepare(
        `INSERT INTO podcasts (feed_url, title, subscribed_at, auto_download, is_active, sort_order, last_error)
         VALUES ('import://old-show', 'Old Show', 9, 1, 1, 5, NULL)`
      )
      .run()
    db.prepare(
      `INSERT INTO episodes (
         podcast_id, guid, title, media_url, file_path, file_size, download_state, played,
         play_position, is_imported, created_at, updated_at
       ) VALUES (?, 'guid-keep', 'Kept', 'https://example.com/a.mp3', '/disk/a.mp3', 42, 'done', 1, 7, 0, 1, 2)`
    ).run(show.lastInsertRowid)

    const podcastsBefore = db.prepare('SELECT * FROM podcasts ORDER BY id').all()
    const episodesBefore = db.prepare('SELECT * FROM episodes').all()

    runMigrations(db)

    expect(db.prepare('SELECT * FROM podcasts ORDER BY id').all()).toEqual(podcastsBefore)
    expect(db.prepare('SELECT * FROM episodes').all()).toEqual(episodesBefore)
    const feedUrl = db
      .prepare('SELECT "notnull" AS required FROM pragma_table_info(\'podcasts\') WHERE name = \'feed_url\'')
      .get() as { required: number }
    expect(feedUrl.required).toBe(0)
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'podcast_folders'").get()).toBeTruthy()
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'podcasts'")
      .all() as { name: string }[]
    expect(indexes.map((index) => index.name)).toEqual(
      expect.arrayContaining(['idx_podcasts_last_episode', 'idx_podcasts_title'])
    )
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])

    const local = db
      .prepare(
        `INSERT INTO podcasts (feed_url, title, subscribed_at, auto_download, is_active, sort_order)
         VALUES (NULL, 'Local', 1, 0, 1, 6)`
      )
      .run()
    expect(Number(local.lastInsertRowid)).toBe(Number(imported.lastInsertRowid) + 1)
    db.close()
  })
})

describe('podcast folders', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let folders: PodcastFolderRepo
  let dir: string

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    folders = new PodcastFolderRepo(db)
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'jtunes-folders-')))
    vi.mocked(fetchFeed).mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function scan(podcastId: number) {
    return scanPodcastFolders({ episodes, folders, podcasts }, podcastId)
  }

  it('lists, adds, and removes folders', () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const added = folders.add(podcast.id, dir)
    expect(folders.list(podcast.id)).toEqual([added])
    expect(() => folders.add(podcast.id, dir)).toThrow('Folder already added')
    expect(() => folders.add(999, dir + '-missing')).toThrow('Podcast not found')
    folders.remove(added.id)
    expect(folders.list(podcast.id)).toEqual([])
    expect(() => folders.remove(added.id)).toThrow('Folder not found')
  })

  it('accepts folder ipc payloads and rejects a blank path', () => {
    expect(podcastFoldersListSchema.parse({ podcastId: 1 })).toEqual({ podcastId: 1 })
    expect(podcastFolderAddSchema.parse({ podcastId: 2, path: '  /shows/old  ' }).path).toBe(
      '/shows/old'
    )
    expect(podcastFolderRemoveSchema.parse({ folderId: 3 })).toEqual({ folderId: 3 })
    expect(() => podcastFolderAddSchema.parse({ podcastId: 2, path: '   ' })).toThrow()
  })

  it('attaches a matching file and adds the rest as imported episodes', async () => {
    const show = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const other = podcasts.create({ feedUrl: 'https://example.com/other.xml', title: 'Other' })
    const [id] = episodes.insertMany(show.id, [episode()])
    episodes.insertMany(other.id, [episode({ guid: 'other', title: 'Hello There' })])
    folders.add(show.id, dir)
    writeFileSync(join(dir, 'Hello There.mp3'), 'audio')
    writeFileSync(join(dir, 'Bonus.mp3'), 'audio')

    const result = await scan(show.id)

    expect(result).toEqual({ added: 1, matched: 1, missing: [] })
    const matched = episodes.getById(id)!
    expect(matched.guid).toBe('ep-1')
    expect(matched.file_path).toBe(join(dir, 'Hello There.mp3'))
    expect(matched.is_imported).toBe(1)
    expect(matched.download_state).toBe('done')

    const added = episodes.listForFolderMatch(show.id).find((row) => row.title === 'Bonus')
    expect(added?.filePath).toBe(join(dir, 'Bonus.mp3'))
    const addedRow = episodes.getById(added!.id)!
    expect(addedRow.guid).toBe(`file:${join(dir, 'Bonus.mp3')}`)
    expect(addedRow.media_url).toBeNull()
    expect(addedRow.is_imported).toBe(1)
    expect(episodes.getById(episodes.listForFolderMatch(other.id)[0].id)!.file_path).toBeNull()
  })

  it('does not attach a second file with the same title', async () => {
    const show = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const [id] = episodes.insertMany(show.id, [episode()])
    folders.add(show.id, dir)
    writeFileSync(join(dir, 'Hello There.mp3'), 'audio')
    writeFileSync(join(dir, 'Hello-There.mp3'), 'audio')

    const result = await scan(show.id)

    expect(result).toEqual({ added: 1, matched: 1, missing: [] })
    const original = episodes.getById(id)!
    expect(original.guid).toBe('ep-1')
    expect(original.file_path).toBeTruthy()
    const extra = episodes.listForFolderMatch(show.id).find((row) => row.id !== id)!
    expect(extra.filePath).toBeTruthy()
    expect(episodes.getById(extra.id)?.guid.startsWith('file:')).toBe(true)
    expect(episodes.getById(extra.id)?.is_imported).toBe(1)
  })

  it('does not add the same file twice', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'Local' })
    folders.add(show.id, dir)
    writeFileSync(join(dir, 'Bonus.mp3'), 'audio')
    await scan(show.id)
    const again = await scan(show.id)
    expect(again).toEqual({ added: 0, matched: 0, missing: [] })
    expect(episodes.listForFolderMatch(show.id)).toHaveLength(1)
  })

  it('skips a path that already belongs to another episode', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'Local' })
    const other = podcasts.create({ feedUrl: null, title: 'Elsewhere' })
    const file = join(dir, 'Bonus.mp3')
    writeFileSync(file, 'audio')
    const [otherId] = episodes.insertMany(other.id, [episode({ guid: 'taken', title: 'Taken' })])
    episodes.attachFile(otherId, file, 5, null)
    folders.add(show.id, dir)

    const result = await scan(show.id)

    expect(result).toEqual({ added: 0, matched: 0, missing: [] })
    expect(episodes.listForFolderMatch(show.id)).toHaveLength(0)
    expect(episodes.findByFilePath(file)?.id).toBe(otherId)
  })

  it('records a missing folder and deletes nothing', async () => {
    const show = podcasts.create({ feedUrl: 'import://old-show', title: 'Old Show' })
    const [id] = episodes.insertMany(show.id, [episode({ guid: 'keep' })])
    folders.add(show.id, join(dir, 'gone'))

    const outcome = await new UpdateService({
      podcasts,
      episodes,
      scanFolders: (podcastId) => scan(podcastId)
    }).check(show.id)

    expect(outcome.errors).toBe(1)
    expect(fetchFeed).not.toHaveBeenCalled()
    expect(podcasts.getById(show.id)?.lastError).toBe(`Folder not found: ${join(dir, 'gone')}`)
    expect(episodes.getById(id)?.guid).toBe('keep')
    expect(episodes.listForFolderMatch(show.id)).toHaveLength(1)
  })

  it('refreshes a local-only podcast without calling the network', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'Desk' })
    folders.add(show.id, dir)
    writeFileSync(join(dir, 'Desk Episode.mp3'), 'audio')
    const queued: number[] = []

    const outcome = await new UpdateService({
      podcasts,
      episodes,
      onNewEpisodes: (_podcast, ids) => queued.push(...ids),
      scanFolders: (podcastId) => scan(podcastId)
    }).check(show.id)

    expect(fetchFeed).not.toHaveBeenCalled()
    expect(outcome.errors).toBe(0)
    expect(outcome.added).toBe(1)
    expect(queued).toEqual([])
    const row = episodes.listForFolderMatch(show.id)[0]
    expect(episodes.getById(row.id)?.is_imported).toBe(1)
    expect(podcasts.getById(show.id)?.lastError).toBeNull()
  })
})

describe('unsubscribe source folders', () => {
  it('leaves source folders and the files inside them alone', () => {
    const plan = unsubscribeTrashPlan({
      filePaths: ['/library/old/ep.mp3', '/downloads/Show/new.mp3'],
      sourceFolders: ['/library/old'],
      downloadFolder: '/downloads/Show'
    })
    expect(plan.trash).toEqual(['/downloads/Show/new.mp3'])
    expect(plan.removeDownloadFolder).toBe(true)

    const samePlace = unsubscribeTrashPlan({
      filePaths: ['/library/old/ep.mp3'],
      sourceFolders: ['/library/old'],
      downloadFolder: '/library/old'
    })
    expect(samePlace.trash).toEqual([])
    expect(samePlace.removeDownloadFolder).toBe(false)

    const nested = unsubscribeTrashPlan({
      filePaths: ['/downloads/Show/archive/ep.mp3', '/downloads/Show/new.mp3'],
      sourceFolders: ['/downloads/Show/archive'],
      downloadFolder: '/downloads/Show'
    })
    expect(nested.trash).toEqual(['/downloads/Show/new.mp3'])
    expect(nested.removeDownloadFolder).toBe(false)
  })
})
