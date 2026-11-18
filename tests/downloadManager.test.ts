import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { DownloadManager } from '../src/main/services/downloadManager'
import type { DownloadOptions, DownloadResult } from '../src/main/services/downloader'
import type { ParsedEpisode } from '../src/shared/types'

function episode(over: Partial<ParsedEpisode> = {}): ParsedEpisode {
  return {
    guid: 'guid-1',
    title: 'Episode One',
    description: null,
    descriptionHtml: null,
    mediaUrl: 'https://cdn.example/episode-one.mp3',
    mediaType: 'audio/mpeg',
    mediaLength: 1000,
    durationSecs: 60,
    releaseDate: Date.now(),
    episodeNumber: null,
    seasonNumber: null,
    artworkUrl: null,
    ...over
  }
}

/** Stays pending until the caller aborts, matching an in-flight transfer. */
function hang(options: DownloadOptions): Promise<DownloadResult> {
  return new Promise((_resolve, reject) => {
    const fail = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    if (options.signal?.aborted) {
      fail()
      return
    }
    options.signal?.addEventListener('abort', fail, { once: true })
  })
}

describe('download lifecycle', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let root: string
  let manager: DownloadManager | null

  beforeEach(async () => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    root = await mkdtemp(join(tmpdir(), 'jtunes-dl-'))
    manager = null
  })

  afterEach(async () => {
    if (manager) {
      for (const item of manager.list()) manager.cancel(item.episodeId)
    }
    await rm(root, { recursive: true, force: true })
  })

  function createManager(seen: DownloadOptions[] = []): DownloadManager {
    manager = new DownloadManager({
      episodes,
      podcasts,
      getDownloadDir: () => root,
      download: async (options) => {
        seen.push(options)
        return hang(options)
      }
    })
    return manager
  }

  it('resets a stuck downloading row to paused and resumes from the .part file', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const [id] = episodes.insertMany(podcast.id, [episode()])
    episodes.setDownloadState(id, 'downloading')

    const destination = join(root, 'Show', 'Episode One.mp3')
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(`${destination}.part`, Buffer.alloc(80))

    const seen: DownloadOptions[] = []
    const downloads = createManager(seen)

    expect(episodes.getById(id)?.download_state).toBe('paused')
    expect(seen).toHaveLength(0)

    downloads.resume(id)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].destination).toBe(destination)
    expect(seen[0].resumeFrom).toBe(80)
    expect(episodes.getById(id)?.download_state).toBe('downloading')
  })

  it('restarts a queued episode on startup and continues a leftover partial', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const [id] = episodes.insertMany(podcast.id, [episode({ title: 'Queued' })])
    episodes.setDownloadState(id, 'queued')

    const destination = join(root, 'Show', 'Queued.mp3')
    await mkdir(dirname(destination), { recursive: true })
    await writeFile(`${destination}.part`, Buffer.alloc(40))

    const seen: DownloadOptions[] = []
    createManager(seen)

    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(seen[0].destination).toBe(destination)
    expect(seen[0].resumeFrom).toBe(40)
    expect(episodes.getById(id)?.download_state).toBe('downloading')
  })

  it('reserves a distinct path for each in-flight download of the same title', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const [first, second] = episodes.insertMany(podcast.id, [
      episode({ guid: 'a', title: 'Same' }),
      episode({ guid: 'b', title: 'Same' })
    ])

    const seen: DownloadOptions[] = []
    const downloads = createManager(seen)
    downloads.enqueue(first)
    downloads.enqueue(second)

    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(seen[0].destination).not.toBe(seen[1].destination)
    expect(seen.map((options) => options.destination).some((path) => path.includes(' (2)'))).toBe(true)
    expect(episodes.getById(first)?.download_state).toBe('downloading')
    expect(episodes.getById(second)?.download_state).toBe('downloading')
  })

  it('pauses, resumes, and cancels without marking the episode failed', async () => {
    const podcast = podcasts.create({ feedUrl: 'https://example.com/feed.xml', title: 'Show' })
    const [id] = episodes.insertMany(podcast.id, [episode()])
    const seen: DownloadOptions[] = []
    const downloads = createManager(seen)

    downloads.enqueue(id)
    await vi.waitFor(() => expect(seen).toHaveLength(1))
    expect(episodes.getById(id)?.download_state).toBe('downloading')

    downloads.pause(id)
    expect(episodes.getById(id)?.download_state).toBe('paused')
    expect(downloads.list().find((item) => item.episodeId === id)?.state).toBe('paused')

    downloads.resume(id)
    await vi.waitFor(() => expect(seen).toHaveLength(2))
    expect(episodes.getById(id)?.download_state).toBe('downloading')
    expect(seen[1].destination).toBe(seen[0].destination)

    downloads.cancel(id)
    expect(episodes.getById(id)?.download_state).toBe('none')
    expect(episodes.getById(id)?.download_error).toBeNull()
    expect(downloads.list().find((item) => item.episodeId === id)).toBeUndefined()
  })
})
