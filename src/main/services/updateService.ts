import { fetchFeed } from './feedService'
import { PodcastRepo } from '../db/repositories/podcastRepo'
import { EpisodeRepo } from '../db/repositories/episodeRepo'
import { UPDATE_CONCURRENCY } from '@shared/constants'
import type { Podcast, UpdateProgress } from '@shared/types'

export interface UpdateServiceDeps {
  podcasts: PodcastRepo
  episodes: EpisodeRepo
  /** Called for every new episode that should be auto-downloaded. */
  onNewEpisodes?: (podcast: Podcast, episodeIds: number[]) => void
  onProgress?: (progress: UpdateProgress) => void
}

export interface UpdateOutcome {
  feeds: number
  added: number
  errors: number
}

/**
 * Checks a set of podcasts for new episodes.
 *
 * Feeds are processed with limited concurrency so a slow or dead feed cannot
 * stall the sweep, and each feed is fetched with a conditional GET so
 * unchanged feeds cost almost nothing.
 */
export class UpdateService {
  private running = false

  constructor(private readonly deps: UpdateServiceDeps) {}

  isRunning(): boolean {
    return this.running
  }

  /** Emits progress without letting a listener error break the sweep. */
  private progress(p: UpdateProgress): void {
    try {
      this.deps.onProgress?.(p)
    } catch {
      // A progress listener must never abort the update.
    }
  }

  /**
   * Checks all active podcasts, or just one when `podcastId` is given.
   * Returns once every feed has been processed.
   */
  async check(podcastId?: number): Promise<UpdateOutcome> {
    if (this.running) {
      return { feeds: 0, added: 0, errors: 0 }
    }
    this.running = true

    const outcome: UpdateOutcome = { feeds: 0, added: 0, errors: 0 }

    try {
      const all = this.deps.podcasts.list(true)
      const targets = podcastId
        ? all.filter((p) => p.id === podcastId)
        : all.filter((p) => p.isActive)

      const total = targets.length
      let done = 0

      // Process in bounded batches to cap concurrent network requests.
      for (let i = 0; i < targets.length; i += UPDATE_CONCURRENCY) {
        const batch = targets.slice(i, i + UPDATE_CONCURRENCY)
        const results = await Promise.all(
          batch.map((podcast) => this.checkOne(podcast, done, total))
        )

        for (const result of results) {
          outcome.feeds += 1
          outcome.added += result.added
          if (result.error) outcome.errors += 1
          done += 1
          this.progress({
            podcastId: result.podcastId,
            podcastTitle: result.podcastTitle,
            done,
            total,
            found: result.found,
            added: result.added,
            status: result.error ? 'error' : 'done',
            message: result.error
          })
        }
      }

      return outcome
    } finally {
      this.running = false
    }
  }

  /** Fetches and syncs a single podcast. */
  private async checkOne(
    podcast: Podcast,
    done: number,
    total: number
  ): Promise<{
    podcastId: number
    podcastTitle: string
    found: number
    added: number
    error?: string
  }> {
    this.progress({
      podcastId: podcast.id,
      podcastTitle: podcast.title,
      done,
      total,
      found: 0,
      added: 0,
      status: 'checking'
    })

    try {
      const meta = this.deps.podcasts.getFeedMeta(podcast.id)
      const result = await fetchFeed(podcast.feedUrl, {
        etag: meta?.etag ?? null,
        lastModified: meta?.lastModified ?? null
      })

      if (result.notModified || !result.feed) {
        this.deps.podcasts.setChecked(podcast.id, null, null)
        return {
          podcastId: podcast.id,
          podcastTitle: podcast.title,
          found: 0,
          added: 0
        }
      }

      const feed = result.feed

      // Update the podcast's own metadata.
      this.deps.podcasts.updateMeta(podcast.id, {
        title: feed.title || podcast.title,
        author: feed.author,
        description: feed.description,
        descriptionHtml: feed.descriptionHtml,
        artworkUrl: feed.artworkUrl,
        category: feed.category,
        language: feed.language,
        link: feed.link,
        etag: result.etag,
        lastModified: result.lastModified
      })

      // Insert new episodes. Existing guids keep play state, download state,
      // and file_path; insertMany refreshes title and media fields that changed.
      const newIds = this.deps.episodes.insertMany(podcast.id, feed.episodes)
      this.deps.podcasts.refreshCounters(podcast.id)
      this.deps.podcasts.setChecked(podcast.id, null, null)

      if (newIds.length > 0) {
        this.deps.onNewEpisodes?.(podcast, newIds)
      }

      return {
        podcastId: podcast.id,
        podcastTitle: podcast.title,
        found: feed.episodes.length,
        added: newIds.length
      }
    } catch (error) {
      // A failing feed must never delete existing episodes.
      this.deps.podcasts.setChecked(podcast.id, null, null)
      return {
        podcastId: podcast.id,
        podcastTitle: podcast.title,
        found: 0,
        added: 0,
        error: (error as Error).message
      }
    }
  }
}

