import { existsSync } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { downloadFile, partialSize, type DownloadOptions, type DownloadResult } from './downloader'
import { EpisodeRepo } from '../db/repositories/episodeRepo'
import { PodcastRepo } from '../db/repositories/podcastRepo'
import { DOWNLOAD_CONCURRENCY } from '@shared/constants'
import { ensureDir, fileExtension, reserveUniquePath, sanitiseFileName } from '../util/fsHelpers'
import type { DownloadQueueItem, DownloadState } from '@shared/types'

export interface DownloadManagerDeps {
  episodes: EpisodeRepo
  podcasts: PodcastRepo
  /** Root directory downloads are written to. */
  getDownloadDir: () => string
  onProgress?: (item: DownloadQueueItem) => void
  /** Test seam. Production uses the real HTTP downloader. */
  download?: (options: DownloadOptions) => Promise<DownloadResult>
}

interface QueueEntry {
  episodeId: number
  mediaUrl: string
  /** Claimed at enqueue time and reused for the transfer, including resume. */
  destination: string
  bytesDone: number
  totalBytes: number | null
  state: DownloadState
  error: string | null
  controller: AbortController | null
  /** Increments on every attempt so a pause/resume cannot finish the old one. */
  attempt: number
  /** Path of the in-progress `.part` file, when a transfer has started. */
  partPath: string | null
}

interface ClaimSource {
  title: string
  media_url: string
  media_type: string | null
  podcast_id: number
  media_length?: number | null
}

/** Reads state without the control-flow narrowing of the caller that writes it. */
function readDownloadState(entry: QueueEntry): DownloadState {
  return entry.state
}

/** Resolves the file extension for an episode from its URL or media type. */
export function resolveAudioExtension(mediaUrl: string, mediaType: string | null): string {
  try {
    const fromUrl = fileExtension(new URL(mediaUrl, 'https://x').pathname)
    if (['.mp3', '.m4a', '.wav'].includes(fromUrl)) return fromUrl
  } catch {
    // Fall through to the media type.
  }
  const type = mediaType?.toLowerCase() ?? ''
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3'
  if (type.includes('mp4') || type.includes('m4a') || type.includes('aac')) return '.m4a'
  if (type.includes('wav') || type.includes('x-wav')) return '.wav'
  return '.mp3'
}

/**
 * Manages the download queue.
 *
 * In-flight work lives in memory, with the chosen file path reserved so two
 * downloads cannot write the same destination. Episode `download_state` is
 * the durable record: on startup, rows left in `downloading` become paused,
 * and rows still `queued` are started again. A paused transfer resumes from
 * its `.part` file.
 */
export class DownloadManager {
  private readonly queue = new Map<number, QueueEntry>()
  /** Destinations claimed by queued, active, or paused downloads. */
  private readonly reserved = new Set<string>()
  private running = 0
  private draining = false

  constructor(private readonly deps: DownloadManagerDeps) {
    this.recover()
  }

  /**
   * Rebuilds the queue from episode rows.
   *
   * `downloading` cannot still be running after a restart, so those rows
   * become paused and keep their partial file. `queued` rows are started
   * again. Paused rows are remembered so their path stays reserved, but they
   * do not start until the user resumes them.
   */
  recover(): void {
    this.deps.episodes.resetDownloadingToPaused()

    for (const id of this.deps.episodes.listIdsByDownloadState('paused')) {
      this.rememberPaused(id)
    }
    for (const id of this.deps.episodes.listIdsByDownloadState('queued')) {
      try {
        this.enqueue(id)
      } catch {
        // No media URL, or the episode disappeared.
      }
    }
  }

  /** Queues a single episode for download. */
  enqueue(episodeId: number): void {
    const episode = this.deps.episodes.getById(episodeId)
    if (!episode) throw new Error(`Episode ${episodeId} not found`)
    if (!episode.media_url) {
      throw new Error(`Episode "${episode.title}" has no media URL to download`)
    }
    if (episode.download_state === 'done') return

    const existing = this.queue.get(episodeId)
    if (existing) {
      if (existing.state === 'paused' || existing.state === 'error') this.resume(episodeId)
      return
    }
    if (episode.download_state === 'downloading') return

    this.queue.set(episodeId, this.entryFor({ ...episode, media_url: episode.media_url }, 'queued'))
    this.deps.episodes.setDownloadState(episodeId, 'queued')
    this.emit(episodeId)
    void this.drain()
  }

  /** Queues every episode of a podcast that is not already downloaded. */
  enqueuePodcast(podcastId: number): void {
    const episodes = this.deps.episodes.listForPodcast(podcastId)
    for (const episode of episodes) {
      if (episode.download_state === 'done') continue
      if (!episode.media_url) continue
      try {
        this.enqueue(episode.id)
      } catch {
        // Skip episodes that cannot be queued (for example, no media URL).
      }
    }
  }

  /** Pauses a download, keeping the partial file and the reserved path. */
  pause(episodeId: number): void {
    const entry = this.queue.get(episodeId)
    if (!entry) return
    if (entry.state === 'downloading' || entry.state === 'queued') {
      entry.state = 'paused'
      entry.controller?.abort()
      this.deps.episodes.setDownloadState(episodeId, 'paused')
      this.emit(episodeId)
    }
  }

  /** Resumes a paused or failed download from its partial file. */
  resume(episodeId: number): void {
    const entry = this.queue.get(episodeId)
    if (!entry) {
      const episode = this.deps.episodes.getById(episodeId)
      if (!episode?.media_url) return
      if (episode.download_state === 'done') return
      this.queue.set(episodeId, this.entryFor({ ...episode, media_url: episode.media_url }, 'queued'))
    } else {
      entry.state = 'queued'
      entry.error = null
    }

    this.deps.episodes.setDownloadState(episodeId, 'queued')
    this.emit(episodeId)
    void this.drain()
  }

  /**
   * Stops a queued, active, or paused download and drops the partial file.
   *
   * The episode returns to `none`. A finished download is left alone.
   */
  cancel(episodeId: number): void {
    const episode = this.deps.episodes.getById(episodeId)
    if (!episode || episode.download_state === 'done') return

    const entry = this.queue.get(episodeId)
    if (entry) {
      entry.state = 'none'
      entry.controller?.abort()
      const part = entry.partPath ?? `${entry.destination}.part`
      this.release(entry.destination)
      this.queue.delete(episodeId)
      void unlink(part).catch(() => undefined)
    }

    this.deps.episodes.setDownloadState(episodeId, 'none')
    this.emitState(episodeId, 'none', null)
  }

  /**
   * Forgets a download without touching the finished file on disk.
   *
   * Returns the path that was detached so the caller can keep, trash or delete
   * it. Separating detachment from file removal is what makes "move to
   * recycle bin" actually work.
   */
  clearDownload(episodeId: number): string | null {
    const filePath = this.deps.episodes.getFilePath(episodeId)
    const entry = this.queue.get(episodeId)
    const partPath = entry?.partPath ?? (entry ? `${entry.destination}.part` : filePath ? `${filePath}.part` : null)
    if (entry) {
      entry.state = 'none'
      entry.controller?.abort()
      this.release(entry.destination)
    }
    this.deps.episodes.setFilePath(episodeId, null, null)
    this.deps.episodes.setDownloadState(episodeId, 'none')
    this.queue.delete(episodeId)
    if (partPath) void unlink(partPath).catch(() => undefined)
    this.emitState(episodeId, 'none', null)
    return filePath
  }

  /** Removes the file from disk permanently and forgets the download. */
  async deleteFile(episodeId: number): Promise<string | null> {
    const filePath = this.clearDownload(episodeId)
    if (filePath) await unlink(filePath).catch(() => undefined)
    return filePath
  }

  /** Removes the file and queues the episode again. */
  async redownload(episodeId: number): Promise<void> {
    await this.deleteFile(episodeId)
    this.enqueue(episodeId)
  }

  /** Cancels any queued or in-flight downloads for a podcast. */
  cancelPodcast(podcastId: number): void {
    for (const entry of [...this.queue.values()]) {
      const episode = this.deps.episodes.getById(entry.episodeId)
      if (episode?.podcast_id === podcastId) {
        this.clearDownload(entry.episodeId)
      }
    }
  }

  /** Current queue contents for the UI. */
  list(): DownloadQueueItem[] {
    return [...this.queue.values()].map((entry) => this.toItem(entry))
  }

  /** Keeps a paused episode's destination reserved without starting it. */
  private rememberPaused(episodeId: number): void {
    if (this.queue.has(episodeId)) return
    const episode = this.deps.episodes.getById(episodeId)
    if (!episode?.media_url) return
    this.queue.set(episodeId, this.entryFor({ ...episode, media_url: episode.media_url }, 'paused'))
  }

  private entryFor(episode: ClaimSource & { id: number }, state: DownloadState): QueueEntry {
    const destination = this.claimDestination(episode)
    return {
      episodeId: episode.id,
      mediaUrl: episode.media_url,
      destination,
      bytesDone: 0,
      totalBytes: episode.media_length ?? null,
      state,
      error: null,
      controller: null,
      attempt: 0,
      partPath: `${destination}.part`
    }
  }

  /**
   * Claims a destination that is neither on disk nor already reserved.
   * The claim is synchronous, so concurrent enqueues cannot share a path.
   */
  private claimDestination(episode: ClaimSource): string {
    const podcast = this.deps.podcasts.getById(episode.podcast_id)
    const dir = join(this.deps.getDownloadDir(), sanitiseFileName(podcast?.title ?? 'Unknown'))
    const fileName = `${sanitiseFileName(episode.title)}${resolveAudioExtension(episode.media_url, episode.media_type)}`
    const destination = reserveUniquePath(
      dir,
      fileName,
      (candidate) => this.reserved.has(candidate) || existsSync(candidate)
    )
    this.reserved.add(destination)
    return destination
  }

  private release(destination: string | null | undefined): void {
    if (destination) this.reserved.delete(destination)
  }

  /** Runs queued downloads up to the concurrency limit. */
  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true

    try {
      while (this.running < DOWNLOAD_CONCURRENCY) {
        const next = [...this.queue.values()].find((e) => e.state === 'queued')
        if (!next) break

        this.running += 1
        next.state = 'downloading'
        this.deps.episodes.setDownloadState(next.episodeId, 'downloading')
        this.emit(next.episodeId)

        void this.runDownload(next)
          .catch(() => undefined)
          .finally(() => {
            this.running -= 1
            void this.drain()
          })
      }
    } finally {
      this.draining = false
    }
  }

  /** Performs a single download into the path reserved at enqueue time. */
  private async runDownload(entry: QueueEntry): Promise<void> {
    if (entry.state !== 'downloading') return

    const attempt = ++entry.attempt
    const controller = new AbortController()
    entry.controller = controller
    const destination = entry.destination
    const stillCurrent = (): boolean =>
      entry.attempt === attempt && entry.state === 'downloading' && this.queue.has(entry.episodeId)

    try {
      await ensureDir(dirname(destination))
      if (!stillCurrent()) return

      const resumeFrom = await partialSize(destination)
      if (!stillCurrent()) return
      entry.partPath = `${destination}.part`
      if (resumeFrom > 0) entry.bytesDone = resumeFrom

      const transfer = this.deps.download ?? downloadFile
      const result = await transfer({
        url: entry.mediaUrl,
        destination,
        resumeFrom,
        signal: controller.signal,
        onProgress: (bytesDone, totalBytes) => {
          if (!stillCurrent()) return
          entry.bytesDone = bytesDone
          entry.totalBytes = totalBytes ?? entry.totalBytes
          this.emit(entry.episodeId)
        }
      })

      if (!stillCurrent()) return

      entry.state = 'done'
      entry.bytesDone = result.bytes
      entry.partPath = null
      this.release(destination)
      this.deps.episodes.setFilePath(entry.episodeId, result.path, result.bytes)
      this.deps.episodes.setDownloadState(entry.episodeId, 'done')
      this.emit(entry.episodeId)
    } catch (error) {
      const message = (error as Error).message
      const state = readDownloadState(entry)
      if (entry.attempt !== attempt || state === 'paused' || state === 'none' || !this.queue.has(entry.episodeId)) {
        if (state === 'paused' && entry.attempt === attempt) this.emit(entry.episodeId)
        return
      }
      entry.state = 'error'
      entry.error = message
      this.deps.episodes.setDownloadState(entry.episodeId, 'error', message)
      this.emit(entry.episodeId)
    } finally {
      if (entry.controller === controller) entry.controller = null
    }
  }

  private toItem(entry: QueueEntry): DownloadQueueItem {
    const episode = this.deps.episodes.getById(entry.episodeId)
    const podcast = episode ? this.deps.podcasts.getById(episode.podcast_id) : null
    return {
      episodeId: entry.episodeId,
      podcastId: episode?.podcast_id ?? 0,
      episodeTitle: episode?.title ?? '',
      podcastTitle: podcast?.title ?? '',
      state: entry.state,
      progress:
        entry.totalBytes && entry.totalBytes > 0 ? Math.min(entry.bytesDone / entry.totalBytes, 1) : 0,
      bytesDone: entry.bytesDone,
      totalBytes: entry.totalBytes,
      error: entry.error
    }
  }

  /** Emits a progress event for an episode still in the queue. */
  private emit(episodeId: number): void {
    const entry = this.queue.get(episodeId)
    if (entry) this.deps.onProgress?.(this.toItem(entry))
  }

  /** Emits a state change for an episode that may already have left the queue. */
  private emitState(episodeId: number, state: DownloadState, error: string | null): void {
    const episode = this.deps.episodes.getById(episodeId)
    const podcast = episode ? this.deps.podcasts.getById(episode.podcast_id) : null
    this.deps.onProgress?.({
      episodeId,
      podcastId: episode?.podcast_id ?? 0,
      episodeTitle: episode?.title ?? '',
      podcastTitle: podcast?.title ?? '',
      state,
      progress: 0,
      bytesDone: 0,
      totalBytes: null,
      error
    })
  }
}
