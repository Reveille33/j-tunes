import { beforeEach, describe, expect, it } from 'vitest'
import { createInMemoryDb, type Db } from '../src/main/db/connection'
import { EpisodeRepo } from '../src/main/db/repositories/episodeRepo'
import { PodcastRepo } from '../src/main/db/repositories/podcastRepo'
import { SearchRepo } from '../src/main/db/repositories/searchRepo'
import { displayedReleaseYear } from '../src/shared/format'
import { calendarTimestamp, type ReleasePrecision } from '../src/shared/releaseDate'
import { yearForShow } from '../src/shared/yearFilter'

describe('year for the open show', () => {
  it('keeps a year the show has and falls back to All years otherwise', () => {
    expect(yearForShow(null, [2019, 2018])).toBeNull()
    expect(yearForShow(2019, [2020, 2019])).toBe(2019)
    expect(yearForShow(2019, [2020, 2018])).toBeNull()
    expect(yearForShow(2019, [])).toBeNull()
  })
})

describe('podcast year filter', () => {
  let db: Db
  let podcasts: PodcastRepo
  let episodes: EpisodeRepo
  let search: SearchRepo

  beforeEach(() => {
    db = createInMemoryDb()
    podcasts = new PodcastRepo(db)
    episodes = new EpisodeRepo(db)
    search = new SearchRepo(db)
  })

  function add(
    podcastId: number,
    guid: string,
    releaseDate: number,
    releasePrecision: ReleasePrecision | null
  ): void {
    episodes.insertImported({
      podcastId,
      guid,
      title: guid,
      releaseDate,
      releasePrecision
    })
  }

  it('lists only the years that show has, and the library list stays global', () => {
    const hill = podcasts.create({ feedUrl: null, title: 'The Greg Hill Show' })
    const other = podcasts.create({ feedUrl: 'https://example.com/other.xml', title: 'Other' })
    add(hill.id, 'hill-2019', calendarTimestamp(2019, 0, 1), 'year')
    add(hill.id, 'hill-2020', calendarTimestamp(2020, 7, 20), 'day')
    add(other.id, 'other-2018', new Date(2018, 3, 2).getTime(), null)

    expect(episodes.listYears(hill.id)).toEqual([2020, 2019])
    expect(episodes.listYears(other.id)).toEqual([2018])
    expect(episodes.listYears(null)).toEqual([2020, 2019, 2018])
    expect(episodes.listYears()).toEqual([2020, 2019, 2018])
  })

  it('matches year-only dates and folder-scan dates by the year they display', () => {
    const hill = podcasts.create({ feedUrl: null, title: 'The Greg Hill Show' })
    const samples: { guid: string; releaseDate: number; precision: ReleasePrecision | null }[] = [
      { guid: 'legacy-jan-1', releaseDate: new Date(2019, 0, 1).getTime(), precision: null },
      { guid: 'year-noon', releaseDate: calendarTimestamp(2019, 0, 1), precision: 'year' },
      { guid: 'year-midnight', releaseDate: Date.UTC(2019, 0, 1), precision: 'year' },
      { guid: 'day-aug-20', releaseDate: calendarTimestamp(2019, 7, 20), precision: 'day' },
      { guid: 'day-dec-31', releaseDate: calendarTimestamp(2018, 11, 31), precision: 'day' }
    ]
    for (const sample of samples) add(hill.id, sample.guid, sample.releaseDate, sample.precision)

    const in2019 = search.query({ filters: { podcastId: hill.id, year: 2019 }, limit: 20 })
    const shown2019 = samples
      .filter((sample) => displayedReleaseYear(sample.releaseDate, sample.precision) === 2019)
      .map((sample) => sample.guid)
      .sort()
    expect(in2019.rows.map((row) => row.guid).sort()).toEqual(shown2019)
    expect(shown2019).toEqual(
      expect.arrayContaining(['legacy-jan-1', 'year-noon', 'year-midnight', 'day-aug-20'])
    )
    expect(in2019.rows.map((row) => row.guid)).not.toContain('day-dec-31')

    const years = episodes.listYears(hill.id)
    expect(years).toContain(2019)
    expect(years).toContain(displayedReleaseYear(calendarTimestamp(2018, 11, 31), 'day'))
  })
})
