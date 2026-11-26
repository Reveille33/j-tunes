import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ITUNES_LIBRARY_MAX_BYTES } from '../src/shared/constants'
import { itunesLibraryPathSchema } from '../src/shared/validation'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { PodcastFolderRepo } from '../src/main/db/repositories/podcastFolderRepo'
import {
  importItunesLibraryFile,
  itunesLibraryTooLargeMessage,
  previewItunesLibraryFile
} from '../src/main/services/itunesLibraryFile'
import type { ItunesImportDeps } from '../src/main/services/itunesImport'

function libraryXml(fileUrl: string): string {
  const location = fileUrl.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>Tracks</key>
  <dict>
    <key>1</key>
    <dict>
      <key>Name</key><string>Pilot</string>
      <key>Artist</key><string>Ada</string>
      <key>Album</key><string>Alpha</string>
      <key>Persistent ID</key><string>AAA1</string>
      <key>Podcast</key><true/>
      <key>Feed URL</key><string>https://alpha.example/feed.xml</string>
      <key>Play Count</key><integer>1</integer>
      <key>Total Time</key><integer>60000</integer>
      <key>Location</key><string>${location}</string>
    </dict>
    <key>2</key>
    <dict>
      <key>Name</key><string>Remote</string>
      <key>Artist</key><string>Ada</string>
      <key>Album</key><string>Alpha</string>
      <key>Persistent ID</key><string>AAA2</string>
      <key>Podcast</key><true/>
      <key>Total Time</key><integer>60000</integer>
      <key>Location</key><string>https://cdn.example/remote.mp3</string>
    </dict>
  </dict>
</dict>
</plist>`
}

describe('iTunes library file import', () => {
  let db: Db
  let deps: ItunesImportDeps
  let dir: string

  beforeEach(async () => {
    db = createInMemoryDb()
    deps = {
      db,
      podcasts: new PodcastRepo(db),
      episodes: new EpisodeRepo(db),
      folders: new PodcastFolderRepo(db)
    }
    dir = await realpath(mkdtempSync(join(tmpdir(), 'jtunes-itunes-file-')))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  function podcastCount(): number {
    return (db.prepare('SELECT COUNT(*) AS n FROM podcasts').get() as { n: number }).n
  }

  it('describes the picker cap as 200 MB', () => {
    expect(
      itunesLibraryTooLargeMessage(ITUNES_LIBRARY_MAX_BYTES + 1, ITUNES_LIBRARY_MAX_BYTES)
    ).toBe('That library is 200.1 MB, which is over the limit of 200 MB.')
  })

  it('rejects an oversized file before treating it as a library', async () => {
    const file = join(dir, 'Library.xml')
    writeFileSync(file, Buffer.alloc(42))
    await expect(previewItunesLibraryFile(deps, file, { maxBytes: 8 })).rejects.toThrow(
      'That library is 42 bytes, which is over the limit of 8 bytes.'
    )
    await expect(importItunesLibraryFile(deps, file, { maxBytes: 8 })).rejects.toThrow(
      /over the limit of 8 bytes/
    )
    expect(podcastCount()).toBe(0)
  })

  it('rejects a directory and a missing path', async () => {
    await expect(previewItunesLibraryFile(deps, dir)).rejects.toThrow(
      'Choose an iTunes Library.xml file.'
    )
    await expect(previewItunesLibraryFile(deps, join(dir, 'missing.xml'))).rejects.toThrow(
      'That file could not be read.'
    )
    expect(podcastCount()).toBe(0)
  })

  it('reports a file with no podcasts and writes nothing', async () => {
    const file = join(dir, 'notes.xml')
    writeFileSync(file, '<plist version="1.0"><dict></dict></plist>')
    await expect(previewItunesLibraryFile(deps, file)).rejects.toThrow(
      'No podcasts were found in that file.'
    )
    expect(podcastCount()).toBe(0)
  })

  it('previews without writing, then imports on confirm', async () => {
    const audio = join(dir, 'pilot.mp3')
    writeFileSync(audio, 'audio')
    const file = join(dir, 'Library.xml')
    writeFileSync(file, libraryXml(pathToFileURL(audio).href))

    const preview = await previewItunesLibraryFile(deps, file)
    expect(preview).toEqual({
      showsCreated: 1,
      showsMatched: 0,
      episodesCreated: 2,
      episodesMatched: 0,
      played: 1,
      missingFiles: 1,
      feedUrlsSeen: 1
    })
    expect(podcastCount()).toBe(0)

    const imported = await importItunesLibraryFile(deps, file)
    expect(imported).toEqual(preview)

    const show = db
      .prepare('SELECT title, feed_url, auto_download FROM podcasts')
      .get() as { title: string; feed_url: string | null; auto_download: number }
    expect(show).toEqual({ title: 'Alpha', feed_url: null, auto_download: 0 })

    const episodes = db
      .prepare(
        'SELECT title, played, file_path, download_state FROM episodes ORDER BY title ASC'
      )
      .all() as { title: string; played: number; file_path: string | null; download_state: string }[]
    expect(episodes).toEqual([
      { title: 'Pilot', played: 1, file_path: audio, download_state: 'done' },
      { title: 'Remote', played: 0, file_path: null, download_state: 'none' }
    ])

    const again = await previewItunesLibraryFile(deps, file)
    expect(again).toMatchObject({
      showsCreated: 0,
      showsMatched: 1,
      episodesCreated: 0,
      episodesMatched: 2,
      played: 0,
      missingFiles: 1,
      feedUrlsSeen: 1
    })
  })
})

describe('itunes library path schema', () => {
  it('accepts a trimmed path and rejects an empty or huge one', () => {
    expect(itunesLibraryPathSchema.parse({ filePath: '  /tmp/Library.xml  ' })).toEqual({
      filePath: '/tmp/Library.xml'
    })
    expect(() => itunesLibraryPathSchema.parse({ filePath: '   ' })).toThrow()
    expect(() => itunesLibraryPathSchema.parse({ filePath: 'x'.repeat(4097) })).toThrow()
    expect(() => itunesLibraryPathSchema.parse({})).toThrow()
  })
})
