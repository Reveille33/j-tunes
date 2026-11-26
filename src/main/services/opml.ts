import { XMLParser } from 'fast-xml-parser'
import type { Podcast } from '@shared/types'

/** Escapes a string for use in an XML attribute or text node. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** True for subscriptions that point at a real feed. */
function isRealFeed(podcast: Podcast): podcast is Podcast & { feedUrl: string } {
  return podcast.feedUrl != null && /^https?:\/\//i.test(podcast.feedUrl)
}

/**
 * Builds an OPML 2.0 subscription list.
 *
 * OPML is the interchange format every other podcast app understands, so this
 * is the "never lose my subscriptions again" escape hatch. Locally imported
 * podcasts use an `import://` pseudo-URL and are skipped because they are not
 * real feeds.
 */
export function buildOpml(podcasts: Podcast[], now: Date = new Date()): string {
  const outlines = podcasts
    .filter(isRealFeed)
    .map((podcast) => {
      const title = escapeXml(podcast.title)
      const html = podcast.link ? ` htmlUrl="${escapeXml(podcast.link)}"` : ''
      const category = podcast.category ? ` category="${escapeXml(podcast.category)}"` : ''
      return `    <outline type="rss" text="${title}" title="${title}" xmlUrl="${escapeXml(
        podcast.feedUrl
      )}"${html}${category} />`
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head>
    <title>j-Tunes subscriptions</title>
    <dateCreated>${now.toUTCString()}</dateCreated>
  </head>
  <body>
${outlines}
  </body>
</opml>
`
}

/** Counts the subscriptions that would be written to the export. */
export function exportableCount(podcasts: Podcast[]): number {
  return podcasts.filter(isRealFeed).length
}

export interface OpmlEntry {
  title: string
  xmlUrl: string
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  processEntities: true
})

/**
 * Extracts feed subscriptions from an OPML document.
 *
 * Outlines may be nested inside folders, so the tree is walked recursively.
 * Duplicate feed URLs are collapsed and non-HTTP entries are ignored.
 */
export function parseOpml(xml: string): OpmlEntry[] {
  if (!xml.trim()) return []

  let doc: Record<string, unknown>
  try {
    doc = parser.parse(xml) as Record<string, unknown>
  } catch {
    return []
  }

  const seen = new Set<string>()
  const entries: OpmlEntry[] = []

  const walk = (node: unknown): void => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (typeof node !== 'object') return

    const obj = node as Record<string, unknown>
    const xmlUrl = obj['@_xmlUrl']
    if (typeof xmlUrl === 'string' && /^https?:\/\//i.test(xmlUrl.trim())) {
      const url = xmlUrl.trim()
      if (!seen.has(url)) {
        seen.add(url)
        const rawTitle = obj['@_text'] ?? obj['@_title']
        entries.push({
          title: typeof rawTitle === 'string' && rawTitle.trim() ? rawTitle.trim() : url,
          xmlUrl: url
        })
      }
    }

    walk(obj.outline)
  }

  const opml = doc.opml as Record<string, unknown> | undefined
  const body = opml?.body as Record<string, unknown> | undefined
  walk(body?.outline)

  return entries
}