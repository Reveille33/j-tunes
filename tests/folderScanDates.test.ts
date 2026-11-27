import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { realpath, stat } from 'node:fs/promises'
import { parseFile } from 'music-metadata'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { PodcastFolderRepo } from '../src/main/db/repositories/podcastFolderRepo'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { scanPodcastFolders } from '../src/main/services/folderScan'
import { calendarTimestamp } from '../src/shared/releaseDate'
import { formatDate } from '../src/shared/format'

vi.mock('music-metadata', () => ({
  parseFile: vi.fn()
}))

const HILL = 'Cancer hero Currivan Alouidor on the Greg Hill Show - 8-20-19'

describe('folder scan release dates', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let folders: PodcastFolderRepo
  let dir: string

  beforeEach(async () => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    folders = new PodcastFolderRepo(db)
    dir = await realpath(mkdtempSync(join(tmpdir(), 'jtunes-dates-')))
    vi.mocked(parseFile).mockReset()
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  async function scan(podcastId: number) {
    return scanPodcastFolders({ episodes, folders, podcasts }, podcastId)
  }

  it('uses 8-20-19 from the title when the ID3 tag is only the year', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'The Greg Hill Show' })
    folders.add(show.id, dir)
    writeFileSync(join(dir, 'currivan.mp3'), 'audio')
    vi.mocked(parseFile).mockResolvedValue({
      common: { title: HILL, year: 2019 },
      format: { duration: 567 }
    } as never)

    const result = await scan(show.id)

    expect(result.added).toBe(1)
    const row = episodes.getById(
      (episodes.listForPodcast(show.id)[0] as { id: number }).id
    )!
    expect(row.release_precision).toBe('day')
    expect(row.release_date).toBe(calendarTimestamp(2019, 7, 20))
    expect(formatDate(row.release_date, 'day')).not.toBe('2019')
    expect(formatDate(row.release_date, 'day')).not.toContain('Jan')
  })

  it('keeps a full TDRC day instead of the year or the filename', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'The Greg Hill Show' })
    folders.add(show.id, dir)
    writeFileSync(join(dir, 'currivan.mp3'), 'audio')
    vi.mocked(parseFile).mockResolvedValue({
      common: { title: 'Show - 1-2-19', date: '2019-08-20', year: 2019 },
      format: { duration: 567 }
    } as never)

    await scan(show.id)

    const row = episodes.listForPodcast(show.id)[0]!
    expect(episodes.getById(row.id)?.release_date).toBe(calendarTimestamp(2019, 7, 20))
  })

  it('repairs a stored January 1 on rescan without clearing play state', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'The Greg Hill Show' })
    folders.add(show.id, dir)
    const file = join(dir, 'currivan.mp3')
    writeFileSync(file, 'audio')
    const real = await realpath(file)
    const id = episodes.insertImported({
      podcastId: show.id,
      guid: `file:${real}`,
      title: HILL,
      releaseDate: new Date(2019, 0, 1).getTime(),
      filePath: real,
      fileSize: 4,
      durationSecs: 567
    })
    episodes.setPlayState(id, true, 42, false)
    vi.mocked(parseFile).mockResolvedValue({
      common: { title: HILL, year: 2019 },
      format: { duration: 567 }
    } as never)

    const result = await scan(show.id)

    expect(result).toEqual({ added: 0, matched: 0, missing: [] })
    const row = episodes.getById(id)!
    expect(row.release_date).toBe(calendarTimestamp(2019, 7, 20))
    expect(row.release_precision).toBe('day')
    expect(row.played).toBe(1)
    expect(row.play_position).toBe(42)
    expect(row.file_path).toBe(real)
  })

  it('stores a bare year as the year, and falls back to mtime when nothing is tagged', async () => {
    const show = podcasts.create({ feedUrl: null, title: 'The Greg Hill Show' })
    folders.add(show.id, dir)
    const yearFile = join(dir, 'interview.mp3')
    const bareFile = join(dir, 'untitled.mp3')
    writeFileSync(yearFile, 'audio')
    writeFileSync(bareFile, 'audio')
    const mtime = new Date('2024-03-15T18:30:00Z')
    utimesSync(bareFile, mtime, mtime)
    vi.mocked(parseFile).mockImplementation(async (path) => {
      if (String(path).endsWith('interview.mp3')) {
        return { common: { title: 'Interview', year: 2019 }, format: { duration: 10 } } as never
      }
      return { common: { title: 'Untitled' }, format: { duration: 10 } } as never
    })

    await scan(show.id)

    const rows = episodes.listForPodcast(show.id)
    const yearRow = rows.find((row) => row.title === 'Interview')!
    const bareRow = rows.find((row) => row.title === 'Untitled')!
    expect(episodes.getById(yearRow.id)?.release_precision).toBe('year')
    expect(formatDate(episodes.getById(yearRow.id)?.release_date, 'year')).toBe('2019')
    const bare = episodes.getById(bareRow.id)!
    expect(bare.release_precision).toBe('day')
    expect(bare.release_date).toBe(Math.round((await stat(await realpath(bareFile))).mtimeMs))
  })
})
