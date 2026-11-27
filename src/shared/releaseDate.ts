/**
 * A release date and how much of it is real.
 * Year-only tags are not stored as January 1: that day is displayed as if
 * the episode were released then.
 */
export type ReleasePrecision = 'day' | 'month' | 'year'

export interface ReleaseDate {
  timestamp: number
  precision: ReleasePrecision
}

const RANK: Record<ReleasePrecision, number> = { year: 1, month: 2, day: 3 }

export function precisionRank(precision: ReleasePrecision): number {
  return RANK[precision]
}

/** Noon UTC, so a calendar day stays on that day in US timezones. */
export function calendarTimestamp(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day, 12, 0, 0, 0)
}

export function releaseYear(date: ReleaseDate): number {
  return new Date(date.timestamp).getUTCFullYear()
}

function validYear(year: number): boolean {
  return Number.isInteger(year) && year >= 1900 && year <= 2100
}

function daysInMonth(year: number, month: number): number {
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
}

function dayStamp(year: number, month: number, day: number): ReleaseDate | null {
  if (!validYear(year) || month < 1 || month > 12) return null
  if (day < 1 || day > daysInMonth(year, month)) return null
  return { timestamp: calendarTimestamp(year, month - 1, day), precision: 'day' }
}

function monthStamp(year: number, month: number): ReleaseDate | null {
  if (!validYear(year) || month < 1 || month > 12) return null
  return { timestamp: calendarTimestamp(year, month - 1, 1), precision: 'month' }
}

export function yearStamp(year: number | null | undefined): ReleaseDate | null {
  if (year == null || !validYear(year)) return null
  return { timestamp: calendarTimestamp(year, 0, 1), precision: 'year' }
}

/**
 * Parses a feed, iTunes, or ID3 date.
 * `2019` is a year. `2019-08` is a month. A full day stays on that calendar day.
 * A zoned timestamp keeps its instant.
 */
export function parseReleaseStamp(value: string | null | undefined): ReleaseDate | null {
  if (value == null) return null
  const trimmed = value.trim()
  if (!trimmed) return null

  if (/^\d{4}$/.test(trimmed)) return yearStamp(Number(trimmed))

  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(trimmed)
  if (compact) return dayStamp(Number(compact[1]), Number(compact[2]), Number(compact[3]))

  const monthOnly = /^(\d{4})[-./](\d{2})$/.exec(trimmed)
  if (monthOnly) return monthStamp(Number(monthOnly[1]), Number(monthOnly[2]))

  const dated = /^(\d{4})[-./](\d{2})[-./](\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
    trimmed
  )
  if (dated) {
    const stamp = dayStamp(Number(dated[1]), Number(dated[2]), Number(dated[3]))
    if (!stamp) return null
    if (!dated[4]) return stamp
    const parsed = Date.parse(trimmed)
    return Number.isNaN(parsed) ? null : { timestamp: parsed, precision: 'day' }
  }

  if (/[a-z]/i.test(trimmed)) {
    const parsed = Date.parse(trimmed)
    if (!Number.isNaN(parsed)) return { timestamp: parsed, precision: 'day' }
  }
  return null
}

/** ID3 / MP4 common tags. A full date beats a year, and a release date beats a recording date. */
export function releaseDateFromCommon(common: {
  year?: number | null
  originalyear?: number | null
  date?: string | null
  originaldate?: string | null
  releasedate?: string | null
}): ReleaseDate | null {
  return mostPrecise(
    parseReleaseStamp(common.releasedate),
    parseReleaseStamp(common.date),
    parseReleaseStamp(common.originaldate),
    yearStamp(common.year),
    yearStamp(common.originalyear)
  )
}

export function mostPrecise(...dates: Array<ReleaseDate | null | undefined>): ReleaseDate | null {
  let best: ReleaseDate | null = null
  for (const date of dates) {
    if (!date) continue
    if (!best || precisionRank(date.precision) > precisionRank(best.precision)) best = date
  }
  return best
}

const AUDIO_EXTENSION = /\.(mp3|m4a|wav)$/i

function labelText(label: string): string {
  return label.trim().replace(AUDIO_EXTENSION, '')
}

function remember(found: Map<string, ReleaseDate>, stamp: ReleaseDate | null): void {
  if (!stamp) return
  const date = new Date(stamp.timestamp)
  const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`
  if (!found.has(key)) found.set(key, stamp)
}

function twoDigitYear(year: number): number {
  return year <= 69 ? 2000 + year : 1900 + year
}

/**
 * A single unambiguous date written in a filename or episode title.
 * Two-digit years are only accepted as their own token at the start or end,
 * so "8-20-19" in "Show - 8-20-19" counts and a number in the middle does not.
 * More than one distinct date is ignored.
 */
export function dateFromLabel(label: string | null | undefined): ReleaseDate | null {
  if (!label) return null
  const text = labelText(label)
  if (!text) return null
  const found = new Map<string, ReleaseDate>()

  for (const match of text.matchAll(
    /(?:^|[^\d])((?:19|20)\d{2})[-./](0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])(?!\d)/g
  )) {
    remember(found, dayStamp(Number(match[1]), Number(match[2]), Number(match[3])))
  }

  for (const match of text.matchAll(
    /(?:^|[^\d])(0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])[-./]((?:19|20)\d{2})(?!\d)/g
  )) {
    remember(found, dayStamp(Number(match[3]), Number(match[1]), Number(match[2])))
  }

  const months =
    'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
  const monthIndex: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    may: 5,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    oct: 10,
    nov: 11,
    dec: 12
  }
  const monthOf = (name: string): number => monthIndex[name.slice(0, 3).toLowerCase()] ?? 0

  for (const match of text.matchAll(
    new RegExp(
      `(?:^|[^\\p{L}\\d])(${months})\\.?\\s+(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?,?\\s+((?:19|20)\\d{2})(?!\\d)`,
      'giu'
    )
  )) {
    remember(found, dayStamp(Number(match[3]), monthOf(match[1] ?? ''), Number(match[2])))
  }
  for (const match of text.matchAll(
    new RegExp(
      `(?:^|[^\\d])(0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?\\s+(${months})\\.?\\s*,?\\s*((?:19|20)\\d{2})(?!\\d)`,
      'giu'
    )
  )) {
    remember(found, dayStamp(Number(match[3]), monthOf(match[2] ?? ''), Number(match[1])))
  }

  const edges = [
    /(?:^|[\s_\-–—])(0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])[-./](\d{2})\s*$/,
    /^\s*(0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])[-./](\d{2})(?:\s*$|[\s_\-–—])/
  ]
  for (const pattern of edges) {
    const match = pattern.exec(text)
    if (!match) continue
    remember(found, dayStamp(twoDigitYear(Number(match[3])), Number(match[1]), Number(match[2])))
  }

  if (found.size !== 1) return null
  return [...found.values()][0] ?? null
}

export function dateFromNames(title: string | null, fileName: string | null): ReleaseDate | null {
  const fromTitle = dateFromLabel(title)
  const fromFile = dateFromLabel(fileName)
  if (fromTitle && fromFile) return fromTitle.timestamp === fromFile.timestamp ? fromTitle : null
  return fromTitle ?? fromFile
}

/**
 * Tags win when they already name a day. A filename date fills in a year-only
 * tag only when the years agree, so a stray "1-2-03" cannot move a 2019 file.
 */
export function mergeTagAndLabel(
  tagged: ReleaseDate | null,
  label: ReleaseDate | null
): ReleaseDate | null {
  if (!label) return tagged
  if (!tagged) return label
  if (precisionRank(label.precision) <= precisionRank(tagged.precision)) return tagged
  if (tagged.precision === 'year' && releaseYear(tagged) !== releaseYear(label)) return tagged
  if (tagged.precision === 'month') {
    const tag = new Date(tagged.timestamp)
    const next = new Date(label.timestamp)
    if (tag.getUTCFullYear() !== next.getUTCFullYear() || tag.getUTCMonth() !== next.getUTCMonth()) {
      return tagged
    }
  }
  return label
}

export function chooseFileReleaseDate(input: {
  tagged: ReleaseDate | null
  title: string | null
  fileName: string | null
  mtimeMs?: number | null
}): ReleaseDate | null {
  const chosen = mergeTagAndLabel(input.tagged, dateFromNames(input.title, input.fileName))
  if (chosen) return chosen
  if (input.mtimeMs != null && Number.isFinite(input.mtimeMs) && input.mtimeMs > 0) {
    return { timestamp: Math.round(input.mtimeMs), precision: 'day' }
  }
  return null
}

/** Local midnight on January 1 is the old year-only placeholder. */
export function inferPrecision(timestamp: number): ReleasePrecision {
  const date = new Date(timestamp)
  if (
    date.getMonth() === 0 &&
    date.getDate() === 1 &&
    date.getHours() === 0 &&
    date.getMinutes() === 0 &&
    date.getSeconds() === 0 &&
    date.getMilliseconds() === 0
  ) {
    return 'year'
  }
  return 'day'
}

export function isUtcNoon(timestamp: number): boolean {
  const date = new Date(timestamp)
  return (
    date.getUTCHours() === 12 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  )
}

export function knownPrecision(value: string | null | undefined): ReleasePrecision | null {
  return value === 'day' || value === 'month' || value === 'year' ? value : null
}

/** True when `incoming` names more of the date than the row already stores. */
export function isClearerDate(current: ReleaseDate | null, incoming: ReleaseDate): boolean {
  if (!current) return true
  return precisionRank(incoming.precision) > precisionRank(current.precision)
}
