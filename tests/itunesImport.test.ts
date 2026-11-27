import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo, type EpisodeInsert } from '../src/main/db/repositories/episodeRepo'
import { PodcastFolderRepo } from '../src/main/db/repositories/podcastFolderRepo'
import { importItunesLibrary, previewItunesImport } from '../src/main/services/itunesImport'
import type { ItunesEpisode, ItunesLibrary, ItunesShow } from '../src/main/services/itunesLibrary'
import type { ScanProgress } from '../src/shared/types'

function show(over: Partial<ItunesShow> & Pick<ItunesShow, 'name' | 'episodes'>): ItunesShow {
  return { author: null, feedUrl: null, ...over }
}

function episode(over: Partial<ItunesEpisode> & Pick<ItunesEpisode, 'guid' | 'title'>): ItunesEpisode {
  return {
    durationSecs: 60,
    releaseDate: null,
    filePath: null,
    played: false,
    positionSecs: 0,
    ...over
  }
}

function library(shows: ItunesShow[]): ItunesLibrary {
  return {
    shows,
    counts: {
      shows: shows.length,
      showsWithFeed: shows.filter((item) => item.feedUrl).length,
      episodes: shows.reduce((sum, item) => sum + item.episodes.length, 0),
      played: 0,
      withoutFile: 0,
      ignored: 0,
      skipped: 0
    }
  }
}

interface EpisodeState {
  podcast_id: number
  file_path: string | null
  played: number
  play_position: number
  download_state: string
}

class ExplodingEpisodes extends EpisodeRepo {
  override insertImported(input: EpisodeInsert): number {
    if (input.guid === 'itunes:BOOM') throw new Error('boom')
    return super.insertImported(input)
  }
}

describe('iTunes library import', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let folders: PodcastFolderRepo
  let dir: string
  const fetchSpy = vi.spyOn(globalThis, 'fetch')

  beforeEach(async () => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    folders = new PodcastFolderRepo(db)
    dir = await realpath(mkdtempSync(join(tmpdir(), 'jtunes-itunes-')))
    fetchSpy.mockClear()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function deps() {
    return { db, podcasts, episodes, folders }
  }

  function state(guid: string): EpisodeState | undefined {
    return db
      .prepare(
        `SELECT podcast_id, file_path, played, play_position, download_state
         FROM episodes WHERE guid = ?`
      )
      .get(guid) as EpisodeState | undefined
  }

  function mustState(guid: string): EpisodeState {
    const row = state(guid)
    if (!row) throw new Error(`missing ${guid}`)
    return row
  }

  function folderPaths(): string[] {
    return (
      db.prepare('SELECT path FROM podcast_folders ORDER BY path ASC').all() as { path: string }[]
    ).map((row) => row.path)
  }

  it('creates local-only shows, exclusive folders, and play state in one pass', async () => {
    const alphaDir = join(dir, 'Alpha')
    const betaDir = join(dir, 'Beta')
    mkdirSync(alphaDir)
    mkdirSync(betaDir)
    const done = join(alphaDir, 'done.mp3')
    const half = join(alphaDir, 'half.mp3')
    const pilot = join(betaDir, 'pilot.mp3')
    writeFileSync(done, 'done')
    writeFileSync(half, 'half')
    writeFileSync(pilot, 'pilot')

    const parsed = library([
      show({
        name: 'Alpha Show',
        author: 'Ada',
        feedUrl: 'https://alpha.example/feed.xml',
        episodes: [
          episode({
            guid: 'itunes:DONE',
            title: 'Done',
            filePath: done,
            played: true,
            positionSecs: 0,
            durationSecs: 3600,
            releaseDate: Date.parse('2014-06-01T12:00:00Z')
          }),
          episode({
            guid: 'itunes:HALF',
            title: 'Halfway',
            filePath: half,
            played: false,
            positionSecs: 125
          }),
          episode({ guid: 'itunes:GONE', title: 'Gone', filePath: join(alphaDir, 'gone.mp3') }),
          episode({ guid: 'itunes:REMOTE', title: 'Remote', filePath: null })
        ]
      }),
      show({
        name: 'Beta Talk',
        author: 'Bea',
        episodes: [episode({ guid: 'itunes:BETA', title: 'Pilot', filePath: pilot })]
      })
    ])

    const preview = await previewItunesImport(deps(), parsed)
    expect(podcasts.list()).toHaveLength(0)

    const summary = await importItunesLibrary(deps(), parsed)
    expect(summary).toEqual(preview)
    expect(summary).toEqual({
      showsCreated: 2,
      showsMatched: 0,
      episodesCreated: 5,
      episodesMatched: 0,
      played: 1,
      missingFiles: 2,
      feedUrlsSeen: 1
    })
    expect(fetchSpy).not.toHaveBeenCalled()

    const alpha = podcasts.list().find((podcast) => podcast.title === 'Alpha Show')
    const beta = podcasts.list().find((podcast) => podcast.title === 'Beta Talk')
    expect(alpha).toMatchObject({ feedUrl: null, autoDownload: false, author: 'Ada', episodeCount: 4 })
    expect(beta).toMatchObject({ feedUrl: null, autoDownload: false, episodeCount: 1 })
    expect(folderPaths()).toEqual([alphaDir, betaDir].sort())

    expect(state('itunes:DONE')).toMatchObject({
      file_path: await realpath(done),
      played: 1,
      play_position: 0,
      download_state: 'done'
    })
    expect(state('itunes:HALF')).toMatchObject({
      played: 0,
      play_position: 125,
      download_state: 'done'
    })
    expect(state('itunes:GONE')).toMatchObject({ file_path: null, download_state: 'none' })
    expect(state('itunes:REMOTE')).toMatchObject({ file_path: null, download_state: 'none' })
  })

  it('re-imports without writing play state again', async () => {
    const alphaDir = join(dir, 'Alpha')
    mkdirSync(alphaDir)
    const half = join(alphaDir, 'half.mp3')
    writeFileSync(half, 'half')
    const halfway = episode({
      guid: 'itunes:HALF',
      title: 'Halfway',
      filePath: half,
      played: false,
      positionSecs: 125
    })
    const parsed = library([
      show({
        name: 'Alpha Show',
        feedUrl: 'https://alpha.example/feed.xml',
        episodes: [halfway]
      })
    ])

    await importItunesLibrary(deps(), parsed)
    const id = mustState('itunes:HALF').podcast_id
    db.prepare('UPDATE episodes SET played = 1, play_position = 7 WHERE guid = ?').run('itunes:HALF')
    halfway.played = true
    halfway.positionSecs = 0

    const again = await importItunesLibrary(deps(), parsed)
    expect(again).toMatchObject({
      showsCreated: 0,
      showsMatched: 1,
      episodesCreated: 0,
      episodesMatched: 1,
      played: 0,
      feedUrlsSeen: 1
    })
    expect(state('itunes:HALF')).toMatchObject({ played: 1, play_position: 7 })
    expect(podcasts.getById(id)?.feedUrl).toBeNull()
    expect(folderPaths()).toEqual([alphaDir])
  })

  it('matches one existing show by feed or by a single title, and keeps its feed', async () => {
    const file = join(dir, 'hello.mp3')
    writeFileSync(file, 'audio')
    const local = podcasts.create({ feedUrl: null, title: 'Local Twin', autoDownload: false })
    const feed = podcasts.create({
      feedUrl: 'https://feed.example/rss',
      title: 'Feed Twin',
      autoDownload: true
    })

    const byFeed = await importItunesLibrary(
      deps(),
      library([
        show({
          name: 'Local Twin',
          feedUrl: 'https://feed.example/rss',
          episodes: [episode({ guid: 'itunes:FEED', title: 'From the feed', filePath: file })]
        })
      ])
    )
    expect(byFeed).toMatchObject({ showsCreated: 0, showsMatched: 1, episodesCreated: 1 })
    expect(mustState('itunes:FEED').podcast_id).toBe(feed.id)
    expect(episodes.listForShowMatch(local.id)).toHaveLength(0)
    expect(podcasts.getById(feed.id)).toMatchObject({
      feedUrl: 'https://feed.example/rss',
      autoDownload: true,
      title: 'Feed Twin'
    })

    const desk = podcasts.create({
      feedUrl: 'https://desk.example/rss',
      title: 'Desk Cast',
      autoDownload: true
    })
    const existingId = episodes.insertImported({
      podcastId: desk.id,
      guid: 'rss:hello',
      title: 'Hello: World'
    })
    db.prepare('UPDATE episodes SET played = 1, play_position = 3 WHERE id = ?').run(existingId)

    const otherFile = join(dir, 'other-show.mp3')
    writeFileSync(otherFile, 'audio')
    const other = podcasts.create({ feedUrl: null, title: 'Other Show', autoDownload: false })
    episodes.insertImported({
      podcastId: other.id,
      guid: 'rss:other',
      title: 'Same file',
      filePath: await realpath(otherFile)
    })

    const byTitle = await importItunesLibrary(
      deps(),
      library([
        show({
          name: 'Desk Cast',
          feedUrl: 'https://other.example/rss',
          episodes: [
            episode({
              guid: 'itunes:HELLO',
              title: 'hello world',
              filePath: file,
              played: false,
              positionSecs: 99
            })
          ]
        }),
        show({
          name: 'Brand New',
          episodes: [
            episode({ guid: 'itunes:OTHER', title: 'Same file', filePath: otherFile, played: true })
          ]
        })
      ])
    )
    expect(byTitle).toMatchObject({
      showsCreated: 1,
      showsMatched: 1,
      episodesCreated: 1,
      episodesMatched: 1,
      played: 1
    })
    expect(state('itunes:HELLO')).toBeUndefined()
    const attached = episodes.getById(existingId)
    expect(attached?.file_path).toBe(await realpath(file))
    expect(attached).toMatchObject({ played: 1, play_position: 3 })
    expect(podcasts.getById(desk.id)?.feedUrl).toBe('https://desk.example/rss')
    expect(mustState('itunes:OTHER').podcast_id).not.toBe(other.id)
    expect(episodes.listForShowMatch(other.id)).toHaveLength(1)
  })

  it('creates a new show when more than one title matches', async () => {
    const first = podcasts.create({ feedUrl: null, title: 'Twin', autoDownload: false })
    const second = podcasts.create({
      feedUrl: 'https://twin.example/a',
      title: 'Twin',
      autoDownload: true
    })
    const summary = await importItunesLibrary(
      deps(),
      library([
        show({
          name: 'Twin',
          feedUrl: 'https://twin.example/b',
          episodes: [episode({ guid: 'itunes:TWIN', title: 'Episode' })]
        })
      ])
    )
    expect(summary).toMatchObject({ showsCreated: 1, showsMatched: 0, feedUrlsSeen: 1 })
    const imported = podcasts.getById(mustState('itunes:TWIN').podcast_id)
    expect(imported).toMatchObject({ title: 'Twin', feedUrl: null, autoDownload: false })
    expect(imported?.id).not.toBe(first.id)
    expect(imported?.id).not.toBe(second.id)
  })

  it('skips a shared folder and a folder another show already owns', async () => {
    const shared = join(dir, 'shared')
    const gamma = join(dir, 'Gamma')
    const delta = join(dir, 'Delta')
    const season = join(gamma, 'Season')
    mkdirSync(shared)
    mkdirSync(season, { recursive: true })
    mkdirSync(delta)
    writeFileSync(join(shared, 'a.mp3'), 'a')
    writeFileSync(join(shared, 'b.mp3'), 'b')
    writeFileSync(join(gamma, 'g.mp3'), 'g')
    writeFileSync(join(season, 's.mp3'), 's')
    writeFileSync(join(delta, 'd.mp3'), 'd')

    const owner = podcasts.create({ feedUrl: null, title: 'Owner', autoDownload: false })
    folders.add(owner.id, gamma)

    await importItunesLibrary(
      deps(),
      library([
        show({
          name: 'Alpha',
          episodes: [episode({ guid: 'itunes:A', title: 'A', filePath: join(shared, 'a.mp3') })]
        }),
        show({
          name: 'Beta',
          episodes: [episode({ guid: 'itunes:B', title: 'B', filePath: join(shared, 'b.mp3') })]
        }),
        show({
          name: 'Gamma',
          episodes: [
            episode({ guid: 'itunes:G', title: 'G', filePath: join(gamma, 'g.mp3') }),
            episode({ guid: 'itunes:S', title: 'S', filePath: join(season, 's.mp3') })
          ]
        }),
        show({
          name: 'Delta',
          episodes: [episode({ guid: 'itunes:D', title: 'D', filePath: join(delta, 'd.mp3') })]
        })
      ])
    )

    expect(folderPaths()).toEqual([delta, gamma].sort())
    expect(folders.list(owner.id).map((folder) => folder.path)).toEqual([gamma])
    expect(mustState('itunes:A').file_path).toBe(await realpath(join(shared, 'a.mp3')))
    expect(mustState('itunes:G').file_path).toBe(await realpath(join(gamma, 'g.mp3')))
    const gammaShow = podcasts.list().find((podcast) => podcast.title === 'Gamma')
    expect(folders.list(gammaShow!.id)).toHaveLength(0)
    expect(folders.list(podcasts.list().find((podcast) => podcast.title === 'Delta')!.id)).toEqual([
      expect.objectContaining({ path: delta })
    ])
  })

  it('rolls the import back when a write fails', async () => {
    const exploding = new ExplodingEpisodes(db)
    const parsed = library([
      show({
        name: 'Alpha',
        feedUrl: 'https://alpha.example/feed.xml',
        episodes: [
          episode({ guid: 'itunes:OK', title: 'Ok' }),
          episode({ guid: 'itunes:BOOM', title: 'Boom', played: true, positionSecs: 10 })
        ]
      })
    ])

    await expect(importItunesLibrary({ db, podcasts, episodes: exploding, folders }, parsed)).rejects.toThrow(
      'boom'
    )
    expect(podcasts.list()).toHaveLength(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM episodes').get()).toEqual({ n: 0 })
    expect(folderPaths()).toEqual([])
  })

  it('reports track progress and still writes in one transaction', async () => {
    const events: ScanProgress[] = []
    const parsed = library([
      show({
        name: 'Alpha',
        episodes: Array.from({ length: 12 }, (_, index) =>
          episode({ guid: `itunes:${index}`, title: `Track ${index}` })
        )
      })
    ])

    const summary = await importItunesLibrary(
      { ...deps(), onProgress: (event) => events.push(event) },
      parsed
    )

    expect(summary.episodesCreated).toBe(12)
    expect(events[0]).toMatchObject({ kind: 'itunes', done: 0, total: 12, phase: 'importing' })
    const last = events[events.length - 1]
    expect(last).toMatchObject({ kind: 'itunes', done: 12, total: 12, phase: 'done' })
    expect(events.filter((event) => event.phase !== 'done').length).toBeLessThan(12)
    expect(podcasts.list()).toHaveLength(1)
  })
})
