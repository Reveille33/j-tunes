import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { PodcastFolderRepo } from '../src/main/db/repositories/podcastFolderRepo'
import { addLocalPodcast } from '../src/main/services/localPodcast'
import { scanPodcastFolders } from '../src/main/services/folderScan'
import { UpdateService } from '../src/main/services/updateService'
import { fetchFeed } from '../src/main/services/feedService'
import { showFeedDownloads } from '../src/shared/podcastFeed'
import { addLocalPodcastSchema } from '../src/shared/validation'

vi.mock('../src/main/services/feedService', () => ({
  fetchFeed: vi.fn()
}))

describe('local podcasts', () => {
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
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'jtunes-local-')))
    vi.mocked(fetchFeed).mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('creates a feedless show, scans its folder, and a later check does not fetch', async () => {
    const file = join(dir, 'Desk Episode.mp3')
    writeFileSync(file, 'audio')

    const created = await addLocalPodcast(
      { podcasts, folders, episodes },
      { title: '  Desk  ', path: dir }
    )

    expect(created.feedUrl).toBeNull()
    expect(created.title).toBe('Desk')
    expect(created.autoDownload).toBe(false)
    expect(created.lastError).toBeNull()
    expect(created.episodeCount).toBe(1)
    expect(folders.list(created.id).map((folder) => folder.path)).toEqual([dir])
    expect(existsSync(file)).toBe(true)
    const row = episodes.listForFolderMatch(created.id)[0]
    expect(episodes.getById(row.id)?.is_imported).toBe(1)
    expect(fetchFeed).not.toHaveBeenCalled()

    const outcome = await new UpdateService({
      podcasts,
      episodes,
      scanFolders: (podcastId) =>
        scanPodcastFolders({ episodes, folders, podcasts }, podcastId)
    }).check(created.id)

    expect(fetchFeed).not.toHaveBeenCalled()
    expect(outcome.errors).toBe(0)
    expect(outcome.added).toBe(0)
    expect(podcasts.getById(created.id)?.lastError).toBeNull()
    expect(episodes.listForFolderMatch(created.id)).toHaveLength(1)
  })

  it('unlinks a folder without deleting its files or episodes', async () => {
    const file = join(dir, 'Kept.mp3')
    writeFileSync(file, 'audio')
    const created = await addLocalPodcast(
      { podcasts, folders, episodes },
      { title: 'Kept', path: dir }
    )
    const folder = folders.list(created.id)[0]

    folders.remove(folder.id)

    expect(folders.list(created.id)).toEqual([])
    expect(existsSync(file)).toBe(true)
    expect(episodes.listForFolderMatch(created.id)).toHaveLength(1)
    expect(episodes.getById(episodes.listForFolderMatch(created.id)[0].id)?.file_path).toBe(file)
  })

  it('shows download actions only when a feed url is stored', () => {
    expect(showFeedDownloads(null)).toBe(false)
    expect(showFeedDownloads('https://example.com/feed.xml')).toBe(true)
    expect(showFeedDownloads('import://old-show')).toBe(true)
  })

  it('requires a name and a folder for a local podcast', () => {
    expect(addLocalPodcastSchema.parse({ title: '  Desk  ', path: '  /shows/desk  ' })).toEqual({
      title: 'Desk',
      path: '/shows/desk'
    })
    expect(() => addLocalPodcastSchema.parse({ title: '   ', path: dir })).toThrow()
    expect(() => addLocalPodcastSchema.parse({ title: 'Desk', path: '   ' })).toThrow()
  })
})
