import { canonicaliseFeedUrl } from './feedService'
import { queueNewestSubscribedEpisode } from './initialDownload'
import { subscribeToFeed } from './subscriptionService'
import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { PodcastRepo } from '../db/repositories/podcastRepo'
import { UPDATE_CONCURRENCY } from '@shared/constants'
import type { OpmlEntry } from './opml'
import type { OpmlImportProgress, OpmlImportSummary } from '@shared/types'

export interface OpmlImportDeps {
  podcasts: PodcastRepo
  episodes: EpisodeRepo
  onProgress?: (progress: OpmlImportProgress) => void
  /**
   * When set, each new subscription queues only its newest episode, using
   * the same rule as a manual subscribe.
   */
  initialDownload?: {
    autoDownloadDefault: () => boolean
    enqueue: (episodeId: number) => void
  }
}

/**
 * Subscribes to every feed in an OPML file.
 *
 * Feeds are fetched with bounded concurrency. An existing subscription is
 * counted as skipped and a failing feed as failed, so one bad URL can never
 * abort the whole import.
 */
export class OpmlImportService {
  private cancelled = false
  private running = false

  constructor(private readonly deps: OpmlImportDeps) {}

  isRunning(): boolean {
    return this.running
  }

  cancel(): void {
    this.cancelled = true
  }

  async import(feeds: OpmlEntry[]): Promise<OpmlImportSummary> {
    this.cancelled = false
    this.running = true

    const summary: OpmlImportSummary = { added: 0, skipped: 0, failed: 0 }
    const total = feeds.length
    let done = 0
    const queue = [...feeds]

    const report = (currentFeed: string | null): void => {
      try {
        this.deps.onProgress?.({ done, total, ...summary, currentFeed })
      } catch {
        // A progress listener must never break the import.
      }
    }

    const worker = async (): Promise<void> => {
      for (;;) {
        if (this.cancelled) return
        const entry = queue.shift()
        if (!entry) return

        try {
          const canonical = canonicaliseFeedUrl(entry.xmlUrl)
          if (this.deps.podcasts.getByFeedUrl(canonical)) {
            summary.skipped += 1
          } else {
            const subscribed = await subscribeToFeed(this.deps, canonical)
            summary.added += 1
            if (this.deps.initialDownload) {
              queueNewestSubscribedEpisode({
                podcast: subscribed.podcast,
                autoDownloadDefault: this.deps.initialDownload.autoDownloadDefault(),
                episodeIds: subscribed.newEpisodeIds,
                episodes: this.deps.episodes,
                enqueue: this.deps.initialDownload.enqueue
              })
            }
          }
        } catch {
          summary.failed += 1
        } finally {
          done += 1
          report(entry.title)
        }
      }
    }

    try {
      const workers = Math.max(1, Math.min(UPDATE_CONCURRENCY, total))
      await Promise.all(Array.from({ length: workers }, () => worker()))
    } finally {
      this.running = false
      report(null)
    }

    return summary
  }
}