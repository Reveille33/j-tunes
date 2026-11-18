import { unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { downloadFile, partialSize } from './downloader'
import { EpisodeRepo } from '../db/repositories/episodeRepo'
import { PodcastRepo } from '../db/repositories/podcastRepo'
import { DOWNLOAD_CONCURRENCY } from '@shared/constants'
import { ensureDir, fileExtension, sanitiseFileName, uniquePath } from '../util/fsHelpers'
import type { DownloadQueueItem, DownloadState } from '@shared/types'

export interface DownloadManagerDeps {
  episodes: EpisodeRepo
  podcasts: PodcastRepo
  /** Root directory downloads are written to. */
  getDownloadDir: () => string
  onProgress?: (item: DownloadQueueItem) => void
}

interface QueueEntry {
  episodeId: number
  mediaUrl: string
  destination: string
  bytesDone: number
  totalBytes: number | null
  state: DownloadState
  error: string | null
  controller: AbortController | null
  /** Path of the in-progress `.part` file, when a transfer has started. */
  partPath: string | null
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
 * The queue is durable: state lives in the database, so a crash or restart
 * resumes interrupted downloads rather than losing them. Only a small number
 * of downloads run concurrently to avoid saturating the network.
 */
export class DownloadManager {
  private readonly queue = new Map<number, QueueEntry>()
  private running = 0
  private draining = false

  constructor(private readonly deps: DownloadManagerDeps) {}

  /** Queues a single episode for download. */
  enqueue(episodeId: number): void {
    const episode = this.deps.episodes.getById(episodeId)
    if (!episode) throw new Error(`Episode ${episodeId} not found`)
    if (!episode.media_url) {
      throw new Error(`Episode "${episode.title}" has no media URL to download`)
    }
    if (episode.download_state === 'done' || episode.download_state === 'downloading') return

    const podcast = this.deps.podcasts.getById(episode.podcast_id)
    const destination = this.buildDestination(
      podcast?.title ?? 'Unknown',
      episode.title,
      episode.media_url,
      episode.media_type
    )

    this.queue.set(episodeId, {
      episodeId,
      mediaUrl: episode.media_url,
      destination,
      bytesDone: 0,
      totalBytes: episode.media_length ?? null,
      state: 'queued',
      error: null,
      controller: null,
      partPath: null
    })

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

  /** Pauses a download, keeping the partial file for a later resume. */
  pause(episodeId: number): void {
    const entry = this.queue.get(episodeId)
    if (!entry) return
    if (entry.state === 'downloading' || entry.state === 'queued') {
      entry.controller?.abort()
      entry.state = 'paused'
      this.deps.episodes.setDownloadState(episodeId, 'paused')
      this.emit(episodeId)
    }
  }

  /** Resumes a paused download from its partial file. */
  resume(episodeId: number): void {
    const entry = this.queue.get(episodeId)
    if (!entry) {
      // The app restarted: rebuild the entry from the database.
      const episode = this.deps.episodes.getById(episodeId)
      if (!episode?.media_url) return
      const podcast = this.deps.podcasts.getById(episode.podcast_id)
      this.queue.set(episodeId, {
        episodeId,
        mediaUrl: episode.media_url,
        destination: this.buildDestination(
          podcast?.title ?? 'Unknown',
          episode.title,
          episode.media_url,
          episode.media_type
        ),
        bytesDone: 0,
        totalBytes: episode.media_length ?? null,
        state: 'queued',
        error: null,
        controller: null,
        partPath: null
      })
    } else {
      entry.state = 'queued'
      entry.error = null
    }

    this.deps.episodes.setDownloadState(episodeId, 'queued')
    this.emit(episodeId)
    void this.drain()
  }

  /**
   * Deletes a downloaded file from disk and resets the episode's state.
   * The caller decides whether the file is removed permanently or trashed.
   */
  /**
   * Forgets a download without touching the file on disk.
   *
   * Returns the path that was detached so the caller can keep, trash or delete
   * it. Separating detachment from file removal is what makes "move to
   * recycle bin" actually work.
   */
  clearDownload(episodeId: number): string | null {
    const filePath = this.deps.episodes.getFilePath(episodeId)
    const entry = this.queue.get(episodeId)
    const partPath = entry?.partPath ?? (filePath ? `${filePath}.part` : null)
    if (entry) {
      entry.state = 'none'
    }
    this.cancel(episodeId)
    this.deps.episodes.setFilePath(episodeId, null, null)
    this.deps.episodes.setDownloadState(episodeId, 'none')
    this.queue.delete(episodeId)
    // A paused download may have left a partial file behind.
    if (partPath) void unlink(partPath).catch(() => undefined)
    this.emit(episodeId)
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

  /** Cancels an in-flight download without deleting any file. */
  cancel(episodeId: number): void {
    const entry = this.queue.get(episodeId)
    entry?.controller?.abort()
  }

  /** Cancels any queued or in-flight downloads for a podcast. */
  cancelPodcast(podcastId: number): void {
    for (const entry of this.queue.values()) {
      const episode = this.deps.episodes.getById(entry.episodeId)
      if (episode?.podcast_id === podcastId) {
        this.clearDownload(entry.episodeId)
      }
    }
  }

  /** Current queue contents for the UI. */
  list(): DownloadQueueItem[] {
    return [...this.queue.values()].map((entry) => {
      const episode = this.deps.episodes.getById(entry.episodeId)
      const podcast = episode ? this.deps.podcasts.getById(episode.podcast_id) : null
      return {
        episodeId: entry.episodeId,
        podcastId: episode?.podcast_id ?? 0,
        episodeTitle: episode?.title ?? '',
        podcastTitle: podcast?.title ?? '',
        state: entry.state,
        progress:
          entry.totalBytes && entry.totalBytes > 0
            ? Math.min(entry.bytesDone / entry.totalBytes, 1)
            : 0,
        bytesDone: entry.bytesDone,
        totalBytes: entry.totalBytes,
        error: entry.error
      }
    })
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

  /** Performs a single download. */
  private async runDownload(entry: QueueEntry): Promise<void> {
    const controller = new AbortController()
    entry.controller = controller

    try {
      const dir = join(
        this.deps.getDownloadDir(),
        sanitiseFileName(this.podcastFolder(entry.episodeId))
      )
      await ensureDir(dir)

      const destination = await uniquePath(dir, this.fileNameFor(entry))

      // Reuse a leftover `.part` file so an interrupted download continues
      // from where it stopped instead of starting over.
      const resumeFrom = await partialSize(destination)
      entry.partPath = `${destination}.part`
      if (resumeFrom > 0) entry.bytesDone = resumeFrom

      const result = await downloadFile({
        url: entry.mediaUrl,
        destination,
        resumeFrom,
        signal: controller.signal,
        onProgress: (bytesDone, totalBytes) => {
          entry.bytesDone = bytesDone
          entry.totalBytes = totalBytes ?? entry.totalBytes
          this.emit(entry.episodeId)
        }
      })

      entry.state = 'done'
      entry.bytesDone = result.bytes
      entry.partPath = null
      this.deps.episodes.setFilePath(entry.episodeId, result.path, result.bytes)
      this.deps.episodes.setDownloadState(entry.episodeId, 'done')
      this.emit(entry.episodeId)
    } catch (error) {
      const message = (error as Error).message
      if (entry.state === 'paused') {
        // A deliberate pause - keep the partial file and the paused state.
        this.emit(entry.episodeId)
        return
      }
      if (entry.state === 'none' || !this.queue.has(entry.episodeId)) {
        // Download was cleared or cancelled - do not record error.
        return
      }
      entry.state = 'error'
      entry.error = message
      this.deps.episodes.setDownloadState(entry.episodeId, 'error', message)
      this.emit(entry.episodeId)
    } finally {
      entry.controller = null
    }
  }

  /** Folder name for a podcast's downloads. */
  private podcastFolder(episodeId: number): string {
    const episode = this.deps.episodes.getById(episodeId)
    if (!episode) return 'Unknown'
    const podcast = this.deps.podcasts.getById(episode.podcast_id)
    return podcast?.title ?? 'Unknown'
  }

  /** Builds the on-disk file name for an episode. */
  private fileNameFor(entry: QueueEntry): string {
    const episode = this.deps.episodes.getById(entry.episodeId)
    const title = sanitiseFileName(episode?.title ?? 'episode')
    return `${title}${resolveAudioExtension(entry.mediaUrl, episode?.media_type ?? null)}`
  }

  /** Builds the full destination path for an episode. */
  private buildDestination(
    podcastTitle: string,
    episodeTitle: string,
    mediaUrl: string,
    mediaType: string | null
  ): string {
    const dir = join(this.deps.getDownloadDir(), sanitiseFileName(podcastTitle))
    const ext = resolveAudioExtension(mediaUrl, mediaType)
    return join(dir, `${sanitiseFileName(episodeTitle)}${ext}`)
  }

  /** Emits a progress event for an episode. */
  private emit(episodeId: number): void {
    const item = this.list().find((i) => i.episodeId === episodeId)
    if (item) this.deps.onProgress?.(item)
  }
}
