import type { ScanProgress } from './types'

/** At most about ten progress events per second, plus the final one. */
export const SCAN_PROGRESS_INTERVAL_MS = 100

export interface ScanProgressClock {
  now(): number
  /** Runs `run` after `delayMs`. The return value cancels it. */
  schedule(delayMs: number, run: () => void): () => void
}

export function systemScanProgressClock(): ScanProgressClock {
  return {
    now: () => Date.now(),
    schedule(delayMs, run) {
      const timer = setTimeout(run, delayMs)
      return () => clearTimeout(timer)
    }
  }
}

export interface ScanProgressReporter {
  report(progress: ScanProgress): void
  /** Drops a pending event. The caller sends `phase: 'done'` itself. */
  dispose(): void
}

/**
 * Forwards scan progress, keeping at most one event per interval.
 * A `phase: 'done'` event is sent immediately and cancels anything waiting.
 */
export function createScanProgressReporter(
  emit: (progress: ScanProgress) => void,
  clock: ScanProgressClock = systemScanProgressClock()
): ScanProgressReporter {
  let lastSentAt = Number.NEGATIVE_INFINITY
  let pending: ScanProgress | null = null
  let cancel: (() => void) | null = null

  const send = (event: ScanProgress): void => {
    if (cancel) {
      cancel()
      cancel = null
    }
    pending = null
    lastSentAt = clock.now()
    emit(event)
  }

  return {
    report(event) {
      if (event.phase === 'done') {
        send(event)
        return
      }
      const elapsed = clock.now() - lastSentAt
      if (elapsed >= SCAN_PROGRESS_INTERVAL_MS) {
        send(event)
        return
      }
      pending = event
      if (cancel) return
      cancel = clock.schedule(SCAN_PROGRESS_INTERVAL_MS - elapsed, () => {
        cancel = null
        if (pending) send(pending)
      })
    },
    dispose() {
      if (cancel) cancel()
      cancel = null
      pending = null
    }
  }
}

/** The sentence shown under a folder path or in the iTunes import dialog. */
export function scanProgressLabel(progress: ScanProgress): string | null {
  if (progress.kind === 'folder') {
    if (progress.phase === 'done') {
      const added = progress.added ?? 0
      return added === 1 ? 'Added 1 episode' : `Added ${added} episodes`
    }
    if (progress.phase === 'counting' || progress.total <= 0) return 'Scanning…'
    const files = progress.total === 1 ? 'file' : 'files'
    return `Scanning… ${progress.done} of ${progress.total} ${files}`
  }
  if (progress.phase === 'done') return null
  const tracks = progress.total === 1 ? 'track' : 'tracks'
  return `Importing… ${progress.done} of ${progress.total} ${tracks}`
}
