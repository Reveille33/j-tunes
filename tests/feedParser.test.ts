import { describe, it, expect } from 'vitest'
import { parseFeed, parseDuration, parseDate, htmlToText } from '../src/main/services/feedParser'

const RSS_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Radiolab</title>
    <link>https://radiolab.org</link>
    <language>en-us</language>
    <description><![CDATA[A show about <b>radiation</b> and the world.]]></description>
    <itunes:author>Radiolab</itunes:author>
    <itunes:image href="https://example.com/art.jpg"/>
    <itunes:category text="Science"/>
    <item>
      <title>Colors</title>
      <description><![CDATA[<p>What is <em>color</em>?</p>]]></description>
      <content:encoded><![CDATA[<p>Full content about color.</p>]]></content:encoded>
      <pubDate>Tue, 05 Nov 2019 12:00:00 GMT</pubDate>
      <guid isPermaLink="false">radiolab-colors</guid>
      <enclosure url="https://example.com/colors.mp3" length="12345678" type="audio/mpeg"/>
      <itunes:duration>01:02:03</itunes:duration>
      <itunes:episode>123</itunes:episode>
      <itunes:season>4</itunes:season>
    </item>
    <item>
      <title>Sound</title>
      <description>A second episode.</description>
      <pubDate>Wed, 06 Nov 2019 12:00:00 GMT</pubDate>
      <guid>sound-2</guid>
      <enclosure url="https://example.com/sound.mp3" length="1000" type="audio/mpeg"/>
      <itunes:duration>45:00</itunes:duration>
    </item>
  </channel>
</rss>`

const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Cast</title>
  <subtitle>An atom powered show</subtitle>
  <updated>2020-01-02T10:00:00Z</updated>
  <author><name>Atom Author</name></author>
  <logo>https://example.com/logo.png</logo>
  <link rel="alternate" href="https://atomcast.example.com"/>
  <entry>
    <title>First Atom Episode</title>
    <id>tag:atomcast.example.com,2020:1</id>
    <published>2020-01-01T09:00:00Z</published>
    <updated>2020-01-01T09:00:00Z</updated>
    <summary>Some summary text</summary>
    <link rel="enclosure" href="https://example.com/atom1.m4a" type="audio/mp4" length="999"/>
  </entry>
</feed>`

describe('feedParser', () => {
  it('parses an RSS 2.0 feed with itunes metadata', () => {
    const feed = parseFeed(RSS_FEED)
    expect(feed.title).toBe('Radiolab')
    expect(feed.author).toBe('Radiolab')
    expect(feed.language).toBe('en-us')
    expect(feed.category).toBe('Science')
    expect(feed.artworkUrl).toBe('https://example.com/art.jpg')
    expect(feed.episodes).toHaveLength(2)
  })

  it('parses item enclosure, duration and dates', () => {
    const feed = parseFeed(RSS_FEED)
    const first = feed.episodes[0]

    expect(first.title).toBe('Colors')
    expect(first.guid).toBe('radiolab-colors')
    expect(first.mediaUrl).toBe('https://example.com/colors.mp3')
    expect(first.mediaType).toBe('audio/mpeg')
    expect(first.mediaLength).toBe(12345678)
    expect(first.durationSecs).toBe(3723)
    expect(first.episodeNumber).toBe(123)
    expect(first.seasonNumber).toBe(4)
    expect(first.releaseDate).toBe(Date.parse('Tue, 05 Nov 2019 12:00:00 GMT'))
  })

  it('keeps both plain text and original HTML for descriptions', () => {
    const feed = parseFeed(RSS_FEED)
    const first = feed.episodes[0]

    // `content:encoded` holds the full content and takes priority over the
    // shorter `description` summary.
    expect(first.description).toBe('Full content about color.')
    expect(first.descriptionHtml).toContain('<p>Full content about color.</p>')
  })

  it('falls back to the description summary when content:encoded is absent', () => {
    const feed = parseFeed(RSS_FEED)
    const second = feed.episodes[1]
    expect(second.description).toBe('A second episode.')
  })

  it('parses MM:SS durations', () => {
    const feed = parseFeed(RSS_FEED)
    expect(feed.episodes[1].durationSecs).toBe(2700)
  })

  it('uses only Atom enclosure or audio and video links as media', () => {
    const xml = `<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Cast</title>
        <entry>
          <title>Page</title>
          <id>page</id>
          <link rel="alternate" type="text/html" href="https://example.com/post"/>
          <link href="https://example.com/also.html"/>
        </entry>
        <entry>
          <title>Audio</title>
          <id>audio</id>
          <link rel="alternate" type="text/html" href="https://example.com/post2"/>
          <link type="audio/mpeg" href="https://cdn.example/ep.mp3"/>
        </entry>
        <entry>
          <title>Video</title>
          <id>video</id>
          <link type="video/mp4" href="https://cdn.example/ep.mp4"/>
        </entry>
      </feed>`
    const feed = parseFeed(xml)
    expect(feed.episodes.map((episode) => episode.mediaUrl)).toEqual([
      null,
      'https://cdn.example/ep.mp3',
      'https://cdn.example/ep.mp4'
    ])
  })

  it('parses an Atom feed', () => {
    const feed = parseFeed(ATOM_FEED)
    expect(feed.title).toBe('Atom Cast')
    expect(feed.author).toBe('Atom Author')
    expect(feed.description).toBe('An atom powered show')
    expect(feed.episodes).toHaveLength(1)
    expect(feed.episodes[0].mediaUrl).toBe('https://example.com/atom1.m4a')
    expect(feed.episodes[0].mediaType).toBe('audio/mp4')
    expect(feed.episodes[0].releaseDate).toBe(Date.parse('2020-01-01T09:00:00Z'))
  })

  it('falls back to a generated guid when none is present', () => {
    const xml = `<rss version="2.0"><channel><title>T</title>
      <item><title>No Guid</title>
      <enclosure url="https://example.com/x.mp3" type="audio/mpeg"/></item>
      </channel></rss>`
    const feed = parseFeed(xml)
    expect(feed.episodes[0].guid).toMatch(/^j-tunes-/)
  })

  it('rejects non-feed documents', () => {
    expect(() => parseFeed('<html><body>not a feed</body></html>')).toThrow()
    expect(() => parseFeed('')).toThrow()
    expect(() => parseFeed('   ')).toThrow()
  })

  it('handles a feed with many items', () => {
    const items = Array.from(
      { length: 500 },
      (_, i) => `<item><title>Ep ${i}</title><guid>g${i}</guid>
        <enclosure url="https://example.com/${i}.mp3" type="audio/mpeg"/></item>`
    ).join('')
    const feed = parseFeed(`<rss version="2.0"><channel><title>Big</title>${items}</channel></rss>`)
    expect(feed.episodes).toHaveLength(500)
  })

  it('parses duration formats', () => {
    expect(parseDuration('01:02:03')).toBe(3723)
    expect(parseDuration('45:00')).toBe(2700)
    expect(parseDuration('90')).toBe(90)
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration('abc')).toBeNull()
  })

  it('parses date formats', () => {
    expect(parseDate('Tue, 05 Nov 2019 12:00:00 GMT')).toBe(Date.parse('2019-11-05T12:00:00Z'))
    expect(parseDate('2020-01-02T10:00:00Z')).toBe(Date.parse('2020-01-02T10:00:00Z'))
    expect(parseDate('not a date')).toBeNull()
    expect(parseDate(null)).toBeNull()
  })

  it('strips html into plain text', () => {
    expect(htmlToText('<p>Hello <b>world</b></p>')).toBe('Hello world')
    expect(htmlToText('a &amp; b')).toBe('a & b')
    expect(htmlToText('<script>bad()</script>safe')).toBe('safe')
    expect(htmlToText('')).toBeNull()
  })
})
