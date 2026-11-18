import { describe, it, expect } from 'vitest'
import { parseFeed } from '../src/main/services/feedParser'

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>Show</title>
    <item>
      <title>Ep 1</title>
      <guid>ep-1</guid>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="100" />
      <podcast:chapters url="https://example.com/ep1-chapters.json" type="application/json+chapters" />
    </item>
    <item>
      <title>Ep 2</title>
      <guid>ep-2</guid>
      <enclosure url="https://example.com/ep2.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`

describe('Podcast 2.0 chapters', () => {
  it('extracts the chapters URL from a podcast:chapters element', () => {
    const feed = parseFeed(RSS)
    expect(feed.episodes).toHaveLength(2)
    expect(feed.episodes[0].chaptersUrl).toBe('https://example.com/ep1-chapters.json')
  })

  it('leaves chaptersUrl null when the feed has none', () => {
    const feed = parseFeed(RSS)
    expect(feed.episodes[1].chaptersUrl ?? null).toBeNull()
  })
})