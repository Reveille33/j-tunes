import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { ITUNES_LIBRARY_MAX_BYTES } from '../src/shared/constants'
import {
  ItunesLibraryTooLargeError,
  parseItunesLibrary,
  type ItunesEpisode
} from '../src/main/services/itunesLibrary'

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/itunes-library.xml')
const fixture = readFileSync(fixturePath, 'utf8')

function episode(shows: { episodes: ItunesEpisode[] }[], guid: string): ItunesEpisode {
  const found = shows.flatMap((show) => show.episodes).find((item) => item.guid === guid)
  if (!found) throw new Error(`missing ${guid}`)
  return found
}

describe('iTunes library parser', () => {
  const library = parseItunesLibrary(fixture)

  it('groups podcast tracks and drops music, playlists, and unusable rows', () => {
    expect(library.shows.map((show) => show.name)).toEqual(['Alpha Show', 'Beta Talk', 'Gamma'])
    expect(library.shows[0]?.author).toBe('Ada Host')
    expect(library.shows[0]?.feedUrl).toBe('https://alpha.example/feed.xml')
    expect(library.shows[0]?.episodes.map((item) => item.guid)).toEqual([
      'itunes:AAA1',
      'itunes:AAA2',
      'itunes:AAA3',
      'itunes:AAA4',
      'itunes:AAA5',
      'itunes:AAA6',
      'itunes:AAA7'
    ])
    expect(library.shows.map((show) => show.episodes.some((item) => item.title === 'Song'))).toEqual([
      false,
      false,
      false
    ])
    expect(library.counts).toEqual({
      shows: 3,
      showsWithFeed: 2,
      episodes: 9,
      played: 3,
      withoutFile: 1,
      ignored: 1,
      skipped: 2
    })
  })

  it('uses Artist as the show name when Album is missing', () => {
    expect(library.shows[1]).toMatchObject({
      name: 'Beta Talk',
      author: 'Beta Talk',
      feedUrl: 'http://beta.example/feed'
    })
    expect(library.shows[1]?.episodes[0]).toMatchObject({
      guid: 'itunes:BBB1',
      title: 'Pilot',
      durationSecs: 1200,
      filePath: '/Users/jeff/Music/Podcasts/Beta/Pilot.mp3'
    })
  })

  it('keeps only http(s) feed URLs', () => {
    expect(library.shows[2]?.feedUrl).toBeNull()
  })

  it('decodes file URLs, including percent-encoding, localhost, and NFC', () => {
    const mid = episode(library.shows, 'itunes:AAA1')
    const unplayed = episode(library.shows, 'itunes:AAA2')
    const macPath = episode(library.shows, 'itunes:AAA3')
    const remote = episode(library.shows, 'itunes:AAA5')
    const cafe = episode(library.shows, 'itunes:AAA7')

    expect(mid.filePath).toBe(
      '/Users/jeff/Music/iTunes/iTunes Media/Podcasts/Alpha Show/Mid bookmark.mp3'
    )
    expect(unplayed.filePath).toBe(
      '/Users/jeff/Music/iTunes/iTunes Media/Podcasts/Alpha Show/Still new.mp3'
    )
    expect(macPath.filePath).toBe('/Users/jeff/Music/Podcasts/Alpha/Almost.mp3')
    expect(remote.filePath).toBeNull()
    expect(cafe.filePath).toBe('/Users/jeff/Music/Podcasts/Alpha/Caf\u00e9.mp3')
    expect(cafe.filePath?.includes('\u0301')).toBe(false)
  })

  it('applies unplayed, bookmark, and play count rules', () => {
    expect(episode(library.shows, 'itunes:AAA1')).toMatchObject({
      title: 'Mid bookmark',
      durationSecs: 3600,
      releaseDate: Date.parse('2014-06-01T12:00:00Z'),
      played: false,
      positionSecs: 120
    })
    expect(episode(library.shows, 'itunes:AAA2')).toMatchObject({
      title: 'Still new',
      played: false,
      positionSecs: 0
    })
    expect(episode(library.shows, 'itunes:AAA3')).toMatchObject({
      title: 'Almost done',
      played: true,
      positionSecs: 0
    })
    expect(episode(library.shows, 'itunes:AAA4')).toMatchObject({
      title: 'Heard it',
      played: true,
      positionSecs: 0
    })
    expect(episode(library.shows, 'itunes:AAA6')).toMatchObject({
      title: 'Bad bookmark',
      played: true,
      positionSecs: 0
    })
  })

  it('refuses text over the size cap and exposes that cap for the picker', () => {
    expect(ITUNES_LIBRARY_MAX_BYTES).toBe(200 * 1024 * 1024)
    expect(parseItunesLibrary('é', { maxBytes: 2 }).counts.episodes).toBe(0)
    expect(() => parseItunesLibrary('é', { maxBytes: 1 })).toThrow(ItunesLibraryTooLargeError)
    expect(() => parseItunesLibrary(fixture, { maxBytes: 32 })).toThrow(/byte cap/)
  })

  it('keeps episode order from the file when track ids are numeric', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict><key>Tracks</key><dict>
  <key>20</key><dict>
    <key>Name</key><string>First</string>
    <key>Album</key><string>Order</string>
    <key>Persistent ID</key><string>O20</string>
    <key>Podcast</key><true/>
  </dict>
  <key>3</key><dict>
    <key>Name</key><string>Second</string>
    <key>Album</key><string>Order</string>
    <key>Persistent ID</key><string>O3</string>
    <key>Podcast</key><true/>
  </dict>
</dict></dict></plist>`
    const parsed = parseItunesLibrary(xml)
    expect(parsed.shows[0]?.episodes.map((item) => item.title)).toEqual(['First', 'Second'])
  })

  it('returns an empty library for an empty document', () => {
    expect(parseItunesLibrary('')).toEqual({
      shows: [],
      counts: {
        shows: 0,
        showsWithFeed: 0,
        episodes: 0,
        played: 0,
        withoutFile: 0,
        ignored: 0,
        skipped: 0
      }
    })
  })
})
