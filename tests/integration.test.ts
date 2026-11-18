import { describe, it, expect, beforeAll } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { SearchRepo } from '../src/main/db/repositories/searchRepo'
import { parseFeed } from '../src/main/services/feedParser'
import { canonicaliseFeedUrl } from '../src/main/services/feedService'
import { normaliseTitle, titleFromFileName } from '../src/main/services/importer'

/**
 * A realistic feed with the namespace mix real-world podcast feeds use.
 */
const REALISTIC_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
  <channel>
    <title>Darknet Diaries</title>
    <link>https://darknetdiaries.com</link>
    <language>en-us</language>
    <description><![CDATA[True stories from the dark side of the internet.]]></description>
    <itunes:author>Jack Rhysider</itunes:author>
    <itunes:image href="https://example.com/dd.jpg"/>
    <itunes:category text="Technology"/>
    <item>
      <title>Car Salesman</title>
      <description><![CDATA[<p>A <b>social engineer</b> learns to sell.</p>]]></description>
      <content:encoded><![CDATA[<p>A social engineer learns to sell.</p>]]></content:encoded>
      <pubDate>Mon, 01 Feb 2021 10:00:00 GMT</pubDate>
      <guid>dd-car-salesman</guid>
      <enclosure url="https://traffic.megaphone.fm/dd-car-salesman.mp3" length="34000000" type="audio/mpeg"/>
      <itunes:duration>44:12</itunes:duration>
      <itunes:episode>70</itunes:episode>
      <itunes:season>4</itunes:season>
    </item>
    <item>
      <title>Amanda</title>
      <description><![CDATA[<p>A hacker gets caught.</p>]]></description>
      <pubDate>Tue, 02 Feb 2021 10:00:00 GMT</pubDate>
      <guid>dd-amanda</guid>
      <enclosure url="https://traffic.megaphone.fm/dd-amanda.mp3" length="28000000" type="audio/mpeg"/>
      <itunes:duration>38:30</itunes:duration>
    </item>
    <item>
      <title>Back from the Dead</title>
      <description><![CDATA[<p>Reviving an old scheme.</p>]]></description>
      <pubDate>Wed, 03 Feb 2021 10:00:00 GMT</pubDate>
      <guid>dd-back-from-the-dead</guid>
      <enclosure url="https://traffic.megaphone.fm/dd-back.mp3" length="41000000" type="audio/mpeg"/>
      <itunes:duration>1:02:05</itunes:duration>
    </item>
  </channel>
</rss>`

describe('integration: subscribe -> parse -> store -> search', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let search: SearchRepo

  beforeAll(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    search = new SearchRepo(db)
  })

  it('subscribes to a feed and stores its episodes', () => {
    const feed = parseFeed(REALISTIC_FEED)
    const podcast = podcasts.create({
      feedUrl: canonicaliseFeedUrl('https://feeds.megaphone.fm/darknetdiaries'),
      title: feed.title,
      author: feed.author,
      description: feed.description,
      artworkUrl: feed.artworkUrl,
      category: feed.category
    })

    const newIds = episodes.insertMany(podcast.id, feed.episodes)
    podcasts.refreshCounters(podcast.id)

    expect(newIds).toHaveLength(3)
    expect(podcasts.getById(podcast.id)?.episodeCount).toBe(3)
    expect(podcasts.getById(podcast.id)?.lastEpisodeAt).toBe(
      Date.parse('Wed, 03 Feb 2021 10:00:00 GMT')
    )
  })

  it('re-checking the feed adds no duplicates', () => {
    const podcast = podcasts.list()[0]
    const feed = parseFeed(REALISTIC_FEED)
    const newIds = episodes.insertMany(podcast.id, feed.episodes)
    expect(newIds).toHaveLength(0)
  })

  it('picks up only genuinely new episodes on the next check', () => {
    const podcast = podcasts.list()[0]
    const feed = parseFeed(REALISTIC_FEED)
    const updated = {
      ...feed,
      episodes: [
        ...feed.episodes,
        {
          ...feed.episodes[0],
          guid: 'dd-brand-new',
          title: 'Brand New Episode',
          releaseDate: Date.parse('Thu, 04 Feb 2021 10:00:00 GMT')
        }
      ]
    }
    const newIds = episodes.insertMany(podcast.id, updated.episodes)
    expect(newIds).toHaveLength(1)
    expect(newIds[0]).toBeGreaterThan(0)
  })

  it('finds episodes by title, description and podcast name', () => {
    const byTitle = search.query({ filters: { text: 'Amanda' } })
    expect(byTitle.total).toBe(1)
    expect(byTitle.rows[0].title).toBe('Amanda')

    // "Brand New Episode" is a clone of "Car Salesman", so it shares the
    // same description and both legitimately match.
    const byDescription = search.query({ filters: { text: 'social engineer' } })
    expect(byDescription.total).toBe(2)
    expect(byDescription.rows.map((r) => r.title).sort()).toEqual([
      'Brand New Episode',
      'Car Salesman'
    ])

    const all = search.query({ limit: 10 })
    expect(all.total).toBe(4)
    expect(all.rows[0].podcastTitle).toBe('Darknet Diaries')
  })

  it('filters by year and sorts by release date', () => {
    const in2021 = search.query({ filters: { year: 2021 } })
    expect(in2021.total).toBe(4)

    const in2020 = search.query({ filters: { year: 2020 } })
    expect(in2020.total).toBe(0)

    const newest = search.query({ sortBy: 'release_date', direction: 'desc' })
    expect(newest.rows[0].title).toBe('Brand New Episode')

    const oldest = search.query({ sortBy: 'release_date', direction: 'asc' })
    expect(oldest.rows[0].title).toBe('Car Salesman')
  })

  it('stores and restores durations and playback positions', () => {
    const amanda = search.query({ filters: { text: 'Amanda' } }).rows[0]
    expect(amanda.durationSecs).toBe(2310)

    episodes.setPlayPosition(amanda.id, 120.5, 2310)
    const reloaded = episodes.getById(amanda.id)!
    expect(reloaded.play_position).toBeCloseTo(120.5)
    expect(reloaded.duration_known).toBe(2310)
  })

  it('normalises feed urls so the same feed is not subscribed twice', () => {
    const a = canonicaliseFeedUrl('https://www.Example.com/feed.xml')
    const b = canonicaliseFeedUrl('http://example.com/feed.xml/')
    const c = canonicaliseFeedUrl('example.com/feed.xml')
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('matches legacy import files to episodes by normalised title', () => {
    const podcast = podcasts.list()[0]
    const match = episodes.findByNormalisedTitle(podcast.id, normaliseTitle('Car Salesman'))
    expect(match).not.toBeNull()

    // A file named "car-salesman.mp3" has no tags, so the title comes from
    // the file name and still matches.
    expect(titleFromFileName('/podcasts/car-salesman.mp3')).toBe('car salesman')
    expect(normaliseTitle(titleFromFileName('/podcasts/car-salesman.mp3'))).toBe(
      normaliseTitle('Car Salesman')
    )
  })

  it('unsubscribing cascades and leaves no orphan episodes', () => {
    const podcast = podcasts.list()[0]
    podcasts.remove(podcast.id)

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM episodes').get() as { n: number }
    expect(remaining.n).toBe(0)
  })
})

