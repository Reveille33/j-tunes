import { XMLParser } from 'fast-xml-parser'
import type { ParsedEpisode, ParsedFeed } from '@shared/types'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: false,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  // A feed with thousands of items still parses fine; this only guards
  // against pathological nesting.
  stopNodes: []
})

type XmlNode = Record<string, unknown>

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Reads a text node that may be a string, a number, or an object with #text. */
function text(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const obj = value as XmlNode
    const inner = obj['#text']
    if (inner !== undefined) return text(inner)
  }
  return null
}

function attr(value: unknown, name: string): string | null {
  if (!value || typeof value !== 'object') return null
  const obj = value as XmlNode
  const key = `@_${name}`
  return text(obj[key])
}

/**
 * Parses an `itunes:duration` value into seconds.
 * Handles `HH:MM:SS`, `MM:SS` and a plain number of seconds.
 */
export function parseDuration(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (trimmed.includes(':')) {
    const parts = trimmed.split(':').map((p) => Number(p.trim()))
    if (parts.some((p) => !Number.isFinite(p))) return null
    return parts.reduce((acc, part) => acc * 60 + part, 0)
  }

  const seconds = Number(trimmed)
  return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds) : null
}

/**
 * Parses an RFC 822 or ISO 8601 date into epoch milliseconds.
 * Returns null when the value cannot be understood.
 */
export function parseDate(value: string | null): number | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  const parsed = Date.parse(trimmed)
  if (!Number.isNaN(parsed)) return parsed

  // Some feeds use "YYYY-MM-DD HH:MM:SS" without a timezone marker.
  const normalised = trimmed.replace(' ', 'T')
  const naive = Date.parse(normalised)
  if (!Number.isNaN(naive)) return naive

  return null
}

/** Strips HTML tags and decodes basic entities for the searchable text. */
export function htmlToText(html: string | null): string | null {
  if (!html) return null
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6])>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return text.length ? text : null
}

/** Picks the first non-null value from a list of candidates. */
function firstText(...values: unknown[]): string | null {
  for (const value of values) {
    const result = text(value)
    if (result) return result
  }
  return null
}

function firstNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const result = text(value)
    if (result === null) continue
    const num = Number(result)
    if (Number.isFinite(num)) return num
  }
  return null
}

/**
 * Extracts the enclosure from an RSS item. Falls back to `media:content`
 * when no `<enclosure>` is present.
 */
function extractEnclosure(item: XmlNode): {
  url: string | null
  type: string | null
  length: number | null
} {
  const enclosures = asArray(item.enclosure as XmlNode | XmlNode[] | undefined)
  for (const enclosure of enclosures) {
    const url = attr(enclosure, 'url')
    if (url) {
      return {
        url,
        type: attr(enclosure, 'type'),
        length: firstNumber(attr(enclosure, 'length'))
      }
    }
  }

  const media = asArray(item['media:content'] as XmlNode | XmlNode[] | undefined)
  for (const entry of media) {
    const url = attr(entry, 'url')
    if (url) {
      return {
        url,
        type: attr(entry, 'type'),
        length: firstNumber(attr(entry, 'fileSize'))
      }
    }
  }

  return { url: null, type: null, length: null }
}

/** Builds a stable guid for items that do not provide one. */
function fallbackGuid(title: string, mediaUrl: string | null, releaseDate: number | null): string {
  const seed = `${title}|${mediaUrl ?? ''}|${releaseDate ?? ''}`
  let hash = 5381
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) + hash + seed.charCodeAt(i)) | 0
  }
  return `j-tunes-${(hash >>> 0).toString(36)}`
}

function parseRssItem(item: XmlNode): ParsedEpisode | null {
  const title = firstText(item.title)
  if (!title) return null

  const descriptionHtml = firstText(
    item['content:encoded'],
    item.description,
    item['itunes:summary']
  )
  const description = htmlToText(descriptionHtml)

  const enclosure = extractEnclosure(item)
  const releaseDate = parseDate(
    firstText(item.pubDate, item['dc:date'], item.published, item.date)
  )
  const durationSecs = parseDuration(firstText(item['itunes:duration']))

  const guid = firstText(item.guid, item.id) ?? fallbackGuid(title, enclosure.url, releaseDate)

  return {
    guid,
    title,
    description,
    descriptionHtml,
    mediaUrl: enclosure.url,
    mediaType: enclosure.type,
    mediaLength: enclosure.length,
    durationSecs,
    releaseDate,
    episodeNumber: firstNumber(item['itunes:episode']),
    seasonNumber: firstNumber(item['itunes:season']),
    artworkUrl: firstText(
      (item['itunes:image'] as XmlNode | undefined)?.['@_href'],
      (item.image as XmlNode | undefined)?.['@_href']
    ),
    chaptersUrl: firstText((item['podcast:chapters'] as XmlNode | undefined)?.['@_url'])
  }
}

function parseAtomEntry(entry: XmlNode): ParsedEpisode | null {
  const title = firstText(entry.title)
  if (!title) return null

  const links = asArray(entry.link as XmlNode | XmlNode[] | undefined)
  let mediaUrl: string | null = null
  let mediaType: string | null = null
  let mediaLength: number | null = null

  for (const link of links) {
    const rel = attr(link, 'rel')
    const href = attr(link, 'href')
    if (!href) continue
    if (rel === 'enclosure' || (!rel && !mediaUrl)) {
      mediaUrl = href
      mediaType = attr(link, 'type')
      const len = firstNumber(attr(link, 'length'))
      if (len !== null) mediaLength = len
    }
  }

  const descriptionHtml = firstText(entry.content, entry.summary)
  const description = htmlToText(descriptionHtml)

  const releaseDate = parseDate(firstText(entry.published, entry.updated))
  const durationSecs = parseDuration(firstText(entry['itunes:duration']))

  const guid = firstText(entry.id) ?? fallbackGuid(title, mediaUrl, releaseDate)

  return {
    guid,
    title,
    description,
    descriptionHtml,
    mediaUrl,
    mediaType,
    mediaLength,
    durationSecs,
    releaseDate,
    episodeNumber: firstNumber(entry['itunes:episode']),
    seasonNumber: firstNumber(entry['itunes:season']),
    artworkUrl: firstText(
      (entry['itunes:image'] as XmlNode | undefined)?.['@_href'],
      (entry.logo as XmlNode | undefined)?.['@_href']
    ),
    chaptersUrl: firstText((entry['podcast:chapters'] as XmlNode | undefined)?.['@_url'])
  }
}

/**
 * Parses an RSS 2.0 or Atom document into a normalised feed.
 * Throws when the XML is not parseable or is not a recognised feed.
 */
export function parseFeed(xml: string): ParsedFeed {
  if (!xml || !xml.trim()) {
    throw new Error('Feed is empty')
  }

  let doc: XmlNode
  try {
    doc = parser.parse(xml) as XmlNode
  } catch (error) {
    throw new Error(`Feed is not valid XML: ${(error as Error).message}`)
  }

  // RSS 2.0
  if (doc.rss) {
    const channel = ((doc.rss as XmlNode).channel ?? {}) as XmlNode
    const items = asArray(channel.item as XmlNode | XmlNode[] | undefined)
    const episodes = items.map(parseRssItem).filter((e): e is ParsedEpisode => e !== null)

    return {
      title: firstText(channel.title) ?? 'Unknown podcast',
      author: firstText(channel['itunes:author'], channel.managingEditor, channel.creator),
      description: htmlToText(firstText(channel.description, channel['itunes:summary'])),
      descriptionHtml: firstText(channel.description, channel['itunes:summary']),
      artworkUrl: firstText(
        (channel['itunes:image'] as XmlNode)?.['@_href'],
        (channel.image as XmlNode)?.['@_url']
      ),
      category: firstText((channel['itunes:category'] as XmlNode)?.['@_text'], channel.category),
      language: firstText(channel.language),
      link: firstText(channel.link),
      episodes
    }
  }

  // Atom
  if (doc.feed) {
    const feed = doc.feed as XmlNode
    const entries = asArray(feed.entry as XmlNode | XmlNode[] | undefined)
    const episodes = entries.map(parseAtomEntry).filter((e): e is ParsedEpisode => e !== null)

    const authorNode = (feed.author ?? {}) as XmlNode
    const atomLinks = asArray(feed.link as XmlNode | XmlNode[] | undefined)
      .filter((l) => attr(l, 'rel') !== 'enclosure')
      .map((l) => attr(l, 'href'))

    return {
      title: firstText(feed.title) ?? 'Unknown podcast',
      author: firstText(authorNode.name, feed['itunes:author']),
      description: htmlToText(firstText(feed.subtitle, feed.summary)),
      descriptionHtml: firstText(feed.subtitle, feed.summary),
      artworkUrl: firstText(
        (feed.logo as XmlNode)?.['@_href'],
        (feed.icon as XmlNode)?.['@_href']
      ),
      category: firstText((feed['itunes:category'] as XmlNode)?.['@_text'], feed.category),
      language: firstText(feed['@_xml:lang']),
      link: firstText(...atomLinks),
      episodes
    }
  }

  throw new Error('Document is not a recognised RSS or Atom feed')
}
