import { describe, it, expect } from 'vitest'
import { buildOpml, escapeXml, exportableCount, parseOpml } from '../src/main/services/opml'
import type { Podcast } from '../src/shared/types'

function podcast(over: Partial<Podcast> = {}): Podcast {
  return {
    id: 1,
    feedUrl: 'https://example.com/feed.xml',
    title: 'Show',
    author: null,
    description: null,
    descriptionHtml: null,
    artworkUrl: null,
    category: null,
    language: null,
    link: null,
    lastCheckedAt: null,
    lastError: null,
    lastEpisodeAt: null,
    episodeCount: 0,
    subscribedAt: 0,
    autoDownload: true,
    isActive: true,
    sortOrder: 0,
    ...over
  }
}

describe('OPML export', () => {
  it('escapes XML metacharacters', () => {
    expect(escapeXml(`Tom & Jerry's <b>"quoted"</b>`)).toBe(
      'Tom &amp; Jerry&apos;s &lt;b&gt;&quot;quoted&quot;&lt;/b&gt;'
    )
  })

  it('writes one outline per real feed with its metadata', () => {
    const xml = buildOpml(
      [
        podcast({
          title: 'A & B',
          feedUrl: 'https://a.example/feed?x=1&y=2',
          link: 'https://a.example',
          category: 'Tech'
        })
      ],
      new Date('2026-01-01T00:00:00Z')
    )

    expect(xml).toContain('<opml version="2.0">')
    expect(xml).toContain('xmlUrl="https://a.example/feed?x=1&amp;y=2"')
    expect(xml).toContain('text="A &amp; B"')
    expect(xml).toContain('htmlUrl="https://a.example"')
    expect(xml).toContain('category="Tech"')
    expect(xml).toContain('Thu, 01 Jan 2026 00:00:00 GMT')
  })

  it('skips locally imported podcasts, which have no real feed URL', () => {
    const podcasts = [
      podcast({ title: 'Real Show' }),
      podcast({ id: 2, title: 'Imported Show', feedUrl: 'import://imported-show' })
    ]
    const xml = buildOpml(podcasts)

    expect(exportableCount(podcasts)).toBe(1)
    expect(xml).toContain('Real Show')
    expect(xml).not.toContain('import://imported-show')
    expect(xml).not.toContain('Imported Show')
  })

  it('produces a body with no outlines when nothing is exportable', () => {
    const xml = buildOpml([podcast({ feedUrl: 'import://x' })])
    expect(exportableCount([podcast({ feedUrl: 'import://x' })])).toBe(0)
    expect(xml).toContain('<body>')
    expect(xml).not.toContain('<outline')
  })
})

describe('OPML import parsing', () => {
  it('reads nested folder outlines and dedupes feed URLs', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <opml version="2.0">
        <body>
          <outline text="Tech">
            <outline type="rss" text="Show A" xmlUrl="https://a.example/feed" />
            <outline type="rss" text="Show B" xmlUrl="https://b.example/feed" />
          </outline>
          <outline type="rss" text="Show A again" xmlUrl="https://a.example/feed" />
          <outline text="A folder with no feed" />
        </body>
      </opml>`

    const entries = parseOpml(xml)
    expect(entries.map((entry) => entry.xmlUrl)).toEqual([
      'https://a.example/feed',
      'https://b.example/feed'
    ])
    expect(entries[0].title).toBe('Show A')
  })

  it('falls back to the URL when an outline has no title', () => {
    const xml = `<opml><body><outline xmlUrl="https://c.example/feed" /></body></opml>`
    expect(parseOpml(xml)[0].title).toBe('https://c.example/feed')
  })

  it('ignores non-HTTP outline entries', () => {
    const xml = `<opml><body><outline text="Local" xmlUrl="import://local" /></body></opml>`
    expect(parseOpml(xml)).toEqual([])
  })

  it('returns nothing for empty or malformed documents', () => {
    expect(parseOpml('')).toEqual([])
    expect(parseOpml('   ')).toEqual([])
    expect(parseOpml('<not-opml/>')).toEqual([])
  })

  it('round-trips through its own exporter', () => {
    const xml = buildOpml([
      podcast({ title: 'X & Y', feedUrl: 'https://x.example/feed?a=1&b=2' })
    ])
    const entries = parseOpml(xml)
    expect(entries).toHaveLength(1)
    expect(entries[0].xmlUrl).toBe('https://x.example/feed?a=1&b=2')
    expect(entries[0].title).toBe('X & Y')
  })
})