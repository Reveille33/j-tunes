import { describe, expect, it } from 'vitest'
import {
  calendarTimestamp,
  chooseFileReleaseDate,
  dateFromLabel,
  parseReleaseStamp,
  releaseDateFromCommon
} from '../src/shared/releaseDate'

const aug20 = calendarTimestamp(2019, 7, 20)
const HILL = 'Cancer hero Currivan Alouidor on the Greg Hill Show - 8-20-19'

describe('parseReleaseStamp', () => {
  it('keeps a year from being stored as January 1', () => {
    expect(parseReleaseStamp('2019')).toEqual({
      timestamp: calendarTimestamp(2019, 0, 1),
      precision: 'year'
    })
    expect(parseReleaseStamp('2019-08')).toEqual({
      timestamp: calendarTimestamp(2019, 7, 1),
      precision: 'month'
    })
  })

  it('keeps a full ID3 day and a zoned timestamp', () => {
    expect(parseReleaseStamp('2019-08-20')).toEqual({ timestamp: aug20, precision: 'day' })
    expect(parseReleaseStamp('20190820')).toEqual({ timestamp: aug20, precision: 'day' })
    expect(parseReleaseStamp('2019-08-20T07:00:00Z')).toEqual({
      timestamp: Date.parse('2019-08-20T07:00:00Z'),
      precision: 'day'
    })
    expect(parseReleaseStamp('Tue, 20 Aug 2019 15:00:00 GMT')?.timestamp).toBe(
      Date.parse('Tue, 20 Aug 2019 15:00:00 GMT')
    )
    expect(parseReleaseStamp('2019-02-31')).toBeNull()
  })
})

describe('ID3 common tags', () => {
  it('prefers a full recording date over the year field', () => {
    expect(releaseDateFromCommon({ year: 2019, date: '2019-08-20' })).toEqual({
      timestamp: aug20,
      precision: 'day'
    })
  })

  it('prefers a release date over a different recording date', () => {
    expect(
      releaseDateFromCommon({ releasedate: '2019-08-20', date: '2019-01-02', year: 2019 })
    ).toEqual({ timestamp: aug20, precision: 'day' })
  })

  it('uses the year when the tags have nothing finer', () => {
    expect(releaseDateFromCommon({ year: 2019 })).toEqual({
      timestamp: calendarTimestamp(2019, 0, 1),
      precision: 'year'
    })
  })
})

describe('dateFromLabel', () => {
  it('reads a trailing 8-20-19 from the Greg Hill title', () => {
    expect(dateFromLabel(HILL)).toEqual({ timestamp: aug20, precision: 'day' })
    expect(dateFromLabel(`${HILL}.mp3`)).toEqual({ timestamp: aug20, precision: 'day' })
    expect(dateFromLabel('8-20-19 Cancer hero')).toEqual({ timestamp: aug20, precision: 'day' })
  })

  it('ignores a number in the middle and two competing dates', () => {
    expect(dateFromLabel('part 1-2-3 of the show')).toBeNull()
    expect(dateFromLabel('8-20-19 and 2019-09-01')).toBeNull()
  })
})

describe('chooseFileReleaseDate', () => {
  it('lets the title date fill in a matching year, and leaves a disagreeing year', () => {
    expect(
      chooseFileReleaseDate({
        tagged: { timestamp: calendarTimestamp(2019, 0, 1), precision: 'year' },
        title: HILL,
        fileName: 'currivan.mp3'
      })
    ).toEqual({ timestamp: aug20, precision: 'day' })

    expect(
      chooseFileReleaseDate({
        tagged: { timestamp: calendarTimestamp(2018, 0, 1), precision: 'year' },
        title: HILL,
        fileName: 'currivan.mp3'
      })?.precision
    ).toBe('year')
  })

  it('does not let a filename replace a full tag date', () => {
    expect(
      chooseFileReleaseDate({
        tagged: { timestamp: calendarTimestamp(2019, 6, 4), precision: 'day' },
        title: HILL,
        fileName: 'currivan.mp3'
      })
    ).toEqual({ timestamp: calendarTimestamp(2019, 6, 4), precision: 'day' })
  })

  it('uses mtime only when the file has no date at all', () => {
    const mtimeMs = Date.parse('2024-03-15T18:30:00Z')
    expect(
      chooseFileReleaseDate({
        tagged: { timestamp: calendarTimestamp(2019, 0, 1), precision: 'year' },
        title: 'Interview',
        fileName: 'interview.mp3',
        mtimeMs
      })?.precision
    ).toBe('year')
    expect(
      chooseFileReleaseDate({
        tagged: null,
        title: 'Interview',
        fileName: 'interview.mp3',
        mtimeMs
      })
    ).toEqual({ timestamp: mtimeMs, precision: 'day' })
  })
})
