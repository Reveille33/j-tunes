import { fileURLToPath } from 'node:url'
import { XMLParser } from 'fast-xml-parser'
import { ITUNES_LIBRARY_MAX_BYTES, RESUME_TAIL_SECONDS } from '@shared/constants'

const NEAR_END_MS = RESUME_TAIL_SECONDS * 1000

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  // A library plist is a shallow dict of tracks. This stops a hostile file
  // from nesting forever. Entity expansion limits come from the parser.
  maxNestedTags: 32
})

type PlistDict = Map<string, Plist>
type Plist = null | boolean | number | string | Plist[] | PlistDict

export interface ItunesEpisode {
  /** `itunes:` plus the track's Persistent ID. */
  guid: string
  title: string
  /** `Total Time` converted from milliseconds. */
  durationSecs: number | null
  /** `Release Date` as epoch milliseconds. */
  releaseDate: number | null
  /**
   * `Location` decoded to a filesystem path and NFC-normalised.
   * A drive letter selects Windows rules; anything else is a POSIX path,
   * including a Mac library opened on Windows. Null when it is not a local file.
   */
  filePath: string | null
  played: boolean
  /** Resume point in seconds. Zero when the episode counts as played. */
  positionSecs: number
}

export interface ItunesShow {
  name: string
  author: string | null
  /** First http(s) `Feed URL` or `Podcast URL` on the show. */
  feedUrl: string | null
  episodes: ItunesEpisode[]
}

export interface ItunesLibraryCounts {
  shows: number
  showsWithFeed: number
  episodes: number
  played: number
  /** Episodes whose location was not a file URL. */
  withoutFile: number
  /** Tracks that are not podcasts. */
  ignored: number
  /** Podcast tracks with no show name or no Persistent ID. */
  skipped: number
}

export interface ItunesLibrary {
  shows: ItunesShow[]
  counts: ItunesLibraryCounts
}

export class ItunesLibraryTooLargeError extends Error {
  readonly bytes: number
  readonly maxBytes: number

  constructor(bytes: number, maxBytes: number) {
    super(`iTunes library is ${bytes} bytes, over the ${maxBytes} byte cap`)
    this.name = 'ItunesLibraryTooLargeError'
    this.bytes = bytes
    this.maxBytes = maxBytes
  }
}

/**
 * Reads an iTunes Library.xml (XML plist) into shows and episodes.
 *
 * Only tracks with `Podcast` true are kept. `Album` is the show name, and
 * `Artist` is the author. When `Album` is missing, `Artist` is the show name.
 * Playlists in the same file are ignored.
 *
 * `maxBytes` defaults to `ITUNES_LIBRARY_MAX_BYTES`, the cap the file picker
 * will use before it reads a library.
 */
export function parseItunesLibrary(
  xml: string,
  options?: { maxBytes?: number }
): ItunesLibrary {
  const maxBytes = options?.maxBytes ?? ITUNES_LIBRARY_MAX_BYTES
  const bytes = Buffer.byteLength(xml, 'utf8')
  if (bytes > maxBytes) throw new ItunesLibraryTooLargeError(bytes, maxBytes)

  const source = xml.charCodeAt(0) === 0xfeff ? xml.slice(1) : xml
  const root = parseRoot(parser.parse(source))
  const tracksValue = root?.get('Tracks')
  const tracks = isDict(tracksValue) ? tracksValue : null

  const shows = new Map<string, ItunesShow>()
  let ignored = 0
  let skipped = 0

  if (tracks) {
    for (const value of tracks.values()) {
      if (!isDict(value)) {
        ignored += 1
        continue
      }
      const mapped = mapTrack(value)
      if (mapped === 'ignored') {
        ignored += 1
        continue
      }
      if (mapped === 'skipped') {
        skipped += 1
        continue
      }

      const key = groupKey(mapped.showName)
      let show = shows.get(key)
      if (!show) {
        show = {
          name: mapped.showName,
          author: mapped.author,
          feedUrl: mapped.feedUrl,
          episodes: []
        }
        shows.set(key, show)
      } else {
        if (!show.author && mapped.author) show.author = mapped.author
        if (!show.feedUrl && mapped.feedUrl) show.feedUrl = mapped.feedUrl
      }
      show.episodes.push(mapped.episode)
    }
  }

  const built = [...shows.values()]
  const episodes = built.reduce((sum, show) => sum + show.episodes.length, 0)
  return {
    shows: built,
    counts: {
      shows: built.length,
      showsWithFeed: built.filter((show) => show.feedUrl != null).length,
      episodes,
      played: built.reduce(
        (sum, show) => sum + show.episodes.filter((episode) => episode.played).length,
        0
      ),
      withoutFile: built.reduce(
        (sum, show) => sum + show.episodes.filter((episode) => episode.filePath == null).length,
        0
      ),
      ignored,
      skipped
    }
  }
}

function mapTrack(track: PlistDict):
  | 'ignored'
  | 'skipped'
  | {
      showName: string
      author: string | null
      feedUrl: string | null
      episode: ItunesEpisode
    } {
  if (track.get('Podcast') !== true) return 'ignored'

  const album = asString(track.get('Album'))
  const artist = asString(track.get('Artist'))
  const showName = album ?? artist
  const persistentId = asString(track.get('Persistent ID'))
  if (!showName || !persistentId) return 'skipped'

  const durationMs = asPositive(track.get('Total Time'))
  const bookmarkMs = asPositive(track.get('Bookmark'))
  const play = playState({
    unplayed: track.get('Unplayed') === true,
    playCount: asCount(track.get('Play Count')),
    durationMs,
    bookmarkMs
  })

  return {
    showName,
    author: artist,
    feedUrl: httpUrl(asString(track.get('Feed URL'))) ?? httpUrl(asString(track.get('Podcast URL'))),
    episode: {
      guid: `itunes:${persistentId}`,
      title: asString(track.get('Name')) ?? 'Untitled',
      durationSecs: durationMs == null ? null : Math.round(durationMs / 1000),
      releaseDate: parseReleaseDate(asString(track.get('Release Date'))),
      filePath: filePathFromLocation(asString(track.get('Location'))),
      played: play.played,
      positionSecs: play.positionSecs
    }
  }
}

/**
 * Unplayed forces played false. A bookmark in the last `RESUME_TAIL_SECONDS`
 * and in the second half of the episode counts as finished, with no resume
 * point. A bookmark past `Total Time` is dropped (some files store a value
 * well beyond the duration). Play count then marks the episode played only
 * when no resume point remains.
 */
function playState(input: {
  unplayed: boolean
  playCount: number
  durationMs: number | null
  bookmarkMs: number | null
}): { played: boolean; positionSecs: number } {
  const bookmark = usableBookmark(input.bookmarkMs, input.durationMs)
  const nearEnd = bookmark != null && isNearEnd(bookmark, input.durationMs)

  if (input.unplayed) {
    if (bookmark != null && !nearEnd) return { played: false, positionSecs: bookmark / 1000 }
    return { played: false, positionSecs: 0 }
  }
  if (nearEnd) return { played: true, positionSecs: 0 }
  if (bookmark != null) return { played: false, positionSecs: bookmark / 1000 }
  if (input.playCount > 0) return { played: true, positionSecs: 0 }
  return { played: false, positionSecs: 0 }
}

/** A bookmark past the episode duration is not a resume point. */
function usableBookmark(bookmarkMs: number | null, durationMs: number | null): number | null {
  if (bookmarkMs == null) return null
  if (durationMs != null && durationMs > 0 && bookmarkMs > durationMs) return null
  return bookmarkMs
}

function isNearEnd(bookmarkMs: number, durationMs: number | null): boolean {
  if (durationMs == null || durationMs <= 0) return false
  const tailStart = Math.max(durationMs - NEAR_END_MS, durationMs / 2)
  return bookmarkMs >= tailStart && bookmarkMs <= durationMs
}

function filePathFromLocation(location: string | null): string | null {
  if (!location) return null
  let url: URL
  try {
    url = new URL(location)
  } catch {
    return null
  }
  if (url.protocol !== 'file:') return null
  // file://localhost is a local file. WHATWG parsing usually clears that host.
  // Any other host is a share, not a file on this machine.
  const host = url.hostname
  if (host !== '' && host.toLowerCase() !== 'localhost') return null
  try {
    // The URL's shape picks the rules. A Mac `file:///Users/...` library has no
    // drive letter, so it stays a POSIX path on Windows instead of staying
    // percent-encoded. `file:///C:/...` uses Windows rules on every OS.
    const filePath = fileURLToPath(url, { windows: windowsFileUrl(url.pathname) })
    const normalised = filePath.normalize('NFC')
    return normalised.length > 0 ? normalised : null
  } catch {
    return null
  }
}

/** `file:///C:/...` has a drive letter. `file:///Users/...` does not. */
function windowsFileUrl(pathname: string): boolean {
  return /^\/[A-Za-z]:(?:\/|$)/.test(pathname)
}

function httpUrl(value: string | null): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return value
  } catch {
    return null
  }
}

function parseReleaseDate(value: string | null): number | null {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function groupKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ')
}

function asString(value: Plist | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.normalize('NFC').trim()
  return trimmed.length > 0 ? trimmed : null
}

function asPositive(value: Plist | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null
  return value
}

function asCount(value: Plist | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return value
}

function isDict(value: Plist | undefined): value is PlistDict {
  return value instanceof Map
}

function parseRoot(parsed: unknown): PlistDict | null {
  const nodes = Array.isArray(parsed) ? parsed : []
  for (const node of nodes) {
    if (tagName(node) !== 'plist') continue
    for (const child of children(node)) {
      const value = parseNode(child)
      if (isDict(value)) return value
    }
  }
  return null
}

function parseNode(node: unknown): Plist | undefined {
  const name = tagName(node)
  if (!name) return undefined
  const kids = children(node)
  switch (name) {
    case 'dict':
      return parseDict(kids)
    case 'array': {
      const items: Plist[] = []
      for (const kid of kids) {
        const value = parseNode(kid)
        if (value !== undefined) items.push(value)
      }
      return items
    }
    case 'string':
    case 'date':
    case 'data':
      return textOf(kids)
    case 'integer':
    case 'real': {
      const raw = textOf(kids).trim()
      if (!raw) return null
      const value = Number(raw)
      return Number.isFinite(value) ? value : null
    }
    case 'true':
      return true
    case 'false':
      return false
    default:
      return undefined
  }
}

function parseDict(kids: unknown[]): PlistDict {
  // A Map keeps document order. A plain object would sort numeric track ids.
  const out: PlistDict = new Map()
  for (let i = 0; i < kids.length; i += 1) {
    if (tagName(kids[i]) !== 'key') continue
    const key = textOf(children(kids[i])).trim()
    const valueNode = kids[i + 1]
    if (!key || tagName(valueNode) == null || tagName(valueNode) === 'key') continue
    i += 1
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    const value = parseNode(valueNode)
    if (value !== undefined) out.set(key, value)
  }
  return out
}

function tagName(node: unknown): string | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null
  for (const key of Object.keys(node as object)) {
    if (key !== ':@' && key !== '#text') return key
  }
  return null
}

function children(node: unknown): unknown[] {
  const name = tagName(node)
  if (!name) return []
  const value = (node as Record<string, unknown>)[name]
  return Array.isArray(value) ? value : []
}

function textOf(nodes: unknown[]): string {
  let out = ''
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += node
      continue
    }
    if (node && typeof node === 'object' && '#text' in node) {
      const text = (node as { '#text': unknown })['#text']
      if (typeof text === 'string') out += text
    }
  }
  return out
}
