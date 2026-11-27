import { describe, expect, it } from 'vitest'
import {
  SCAN_PROGRESS_INTERVAL_MS,
  createScanProgressReporter,
  scanProgressLabel,
  type ScanProgressClock
} from '../src/shared/scanProgress'
import type { ScanProgress } from '../src/shared/types'

function manualClock(): ScanProgressClock & { advance(ms: number): void } {
  let time = 0
  let scheduled: { at: number; run: () => void } | null = null
  return {
    now: () => time,
    schedule(delayMs, run) {
      scheduled = { at: time + delayMs, run }
      return () => {
        if (scheduled?.run === run) scheduled = null
      }
    },
    advance(ms) {
      time += ms
      if (scheduled && time >= scheduled.at) {
        const run = scheduled.run
        scheduled = null
        run()
      }
    }
  }
}

describe('scan progress reporter', () => {
  it('reaches the total and always sends the final event', () => {
    const clock = manualClock()
    const events: ScanProgress[] = []
    const reporter = createScanProgressReporter((event) => events.push(event), clock)
    const total = 50

    for (let done = 1; done <= total; done += 1) {
      reporter.report({ kind: 'folder', folderPath: '/shows', done, total, phase: 'scanning' })
    }
    reporter.report({
      kind: 'folder',
      folderPath: '/shows',
      done: total,
      total,
      phase: 'done',
      added: total
    })

    const last = events[events.length - 1]
    expect(last).toMatchObject({ phase: 'done', done: total, total, added: total })
    expect(events.some((event) => event.done === total)).toBe(true)
    expect(events.filter((event) => event.phase === 'done')).toHaveLength(1)
  })

  it('sends at most one update per interval and keeps the latest count', () => {
    const clock = manualClock()
    const events: ScanProgress[] = []
    const reporter = createScanProgressReporter((event) => events.push(event), clock)

    reporter.report({ kind: 'itunes', done: 1, total: 10, phase: 'importing' })
    reporter.report({ kind: 'itunes', done: 2, total: 10, phase: 'importing' })
    reporter.report({ kind: 'itunes', done: 3, total: 10, phase: 'importing' })
    expect(events.map((event) => event.done)).toEqual([1])

    clock.advance(SCAN_PROGRESS_INTERVAL_MS)
    expect(events.map((event) => event.done)).toEqual([1, 3])

    clock.advance(SCAN_PROGRESS_INTERVAL_MS)
    reporter.report({ kind: 'itunes', done: 4, total: 10, phase: 'importing' })
    expect(events.map((event) => event.done)).toEqual([1, 3, 4])
  })

  it('sends the final event immediately and drops a waiting update', () => {
    const clock = manualClock()
    const events: ScanProgress[] = []
    const reporter = createScanProgressReporter((event) => events.push(event), clock)

    reporter.report({ kind: 'itunes', done: 1, total: 8, phase: 'importing' })
    reporter.report({ kind: 'itunes', done: 7, total: 8, phase: 'importing' })
    reporter.report({ kind: 'itunes', done: 8, total: 8, phase: 'done' })
    clock.advance(SCAN_PROGRESS_INTERVAL_MS)

    expect(events).toEqual([
      { kind: 'itunes', done: 1, total: 8, phase: 'importing' },
      { kind: 'itunes', done: 8, total: 8, phase: 'done' }
    ])
    reporter.dispose()
  })
})

describe('scan progress label', () => {
  it('describes a folder scan and its result', () => {
    expect(
      scanProgressLabel({ kind: 'folder', folderPath: '/a', done: 0, total: 0, phase: 'counting' })
    ).toBe('Scanning…')
    expect(
      scanProgressLabel({ kind: 'folder', folderPath: '/a', done: 120, total: 500, phase: 'scanning' })
    ).toBe('Scanning… 120 of 500 files')
    expect(
      scanProgressLabel({
        kind: 'folder',
        folderPath: '/a',
        done: 500,
        total: 500,
        phase: 'done',
        added: 500
      })
    ).toBe('Added 500 episodes')
    expect(
      scanProgressLabel({
        kind: 'folder',
        folderPath: '/a',
        done: 1,
        total: 1,
        phase: 'done',
        added: 1
      })
    ).toBe('Added 1 episode')
  })

  it('describes an iTunes import and clears the line when it finishes', () => {
    expect(scanProgressLabel({ kind: 'itunes', done: 4, total: 20, phase: 'importing' })).toBe(
      'Importing… 4 of 20 tracks'
    )
    expect(scanProgressLabel({ kind: 'itunes', done: 20, total: 20, phase: 'done' })).toBeNull()
  })
})
