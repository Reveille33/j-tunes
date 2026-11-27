import { describe, it, expect } from 'vitest'
import {
  formatDuration,
  formatDurationLong,
  formatBytes,
  formatDate,
  formatIsoDate
} from '../src/shared/format'

describe('formatDuration', () => {
  it('formats zero seconds as 0:00', () => {
    expect(formatDuration(0)).toBe('0:00')
  })

  it('formats missing or invalid durations as --:--', () => {
    expect(formatDuration(null)).toBe('--:--')
    expect(formatDuration(undefined)).toBe('--:--')
    expect(formatDuration(NaN)).toBe('--:--')
    expect(formatDuration(Infinity)).toBe('--:--')
    expect(formatDuration(-10)).toBe('--:--')
  })

  it('formats seconds and minutes correctly', () => {
    expect(formatDuration(5)).toBe('0:05')
    expect(formatDuration(59)).toBe('0:59')
    expect(formatDuration(60)).toBe('1:00')
    expect(formatDuration(125)).toBe('2:05')
  })

  it('formats hours correctly', () => {
    expect(formatDuration(3600)).toBe('1:00:00')
    expect(formatDuration(3665)).toBe('1:01:05')
    expect(formatDuration(7325)).toBe('2:02:05')
  })
})

describe('formatDurationLong', () => {
  it('handles empty or non-positive durations', () => {
    expect(formatDurationLong(0)).toBe('')
    expect(formatDurationLong(-5)).toBe('')
    expect(formatDurationLong(null)).toBe('')
    expect(formatDurationLong(undefined)).toBe('')
    expect(formatDurationLong(NaN)).toBe('')
  })

  it('formats sub-minute seconds', () => {
    expect(formatDurationLong(25)).toBe('25s')
  })

  it('formats minutes', () => {
    expect(formatDurationLong(120)).toBe('2m')
  })

  it('properly rolls over 59+ minutes to 1h without showing 60m', () => {
    // 3590 seconds is 59m 50s. Rounding 59.83 minutes gives 60.
    // It should roll over to 1h rather than "60m" or "0h 60m".
    expect(formatDurationLong(3590)).toBe('1h')
    expect(formatDurationLong(3570)).toBe('1h')
    expect(formatDurationLong(3600)).toBe('1h')
    expect(formatDurationLong(3660)).toBe('1h 1m')
    expect(formatDurationLong(7190)).toBe('2h')
  })
})

describe('formatBytes', () => {
  it('formats bytes, KB, MB, GB', () => {
    expect(formatBytes(0)).toBe('')
    expect(formatBytes(-100)).toBe('')
    expect(formatBytes(500)).toBe('500 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(10 * 1024 * 1024)).toBe('10 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })
})

describe('formatDate & formatIsoDate', () => {
  it('formats ISO dates', () => {
    expect(formatIsoDate(null)).toBe('')
    const ts = new Date('2024-05-15T12:00:00Z').getTime()
    expect(formatIsoDate(ts)).toBe('2024-05-15')
  })

  it('handles null dates in formatDate', () => {
    expect(formatDate(null)).toBe('--')
    expect(formatDate(undefined)).toBe('--')
  })

  it('shows a year-only date as the year', () => {
    expect(formatDate(new Date(2019, 0, 1).getTime())).toBe('2019')
    expect(formatDate(Date.UTC(2019, 0, 1, 12), 'year')).toBe('2019')
  })
})
