import { parseFile } from 'music-metadata'
import { basename, extname, dirname } from 'node:path'
import { EpisodeRepo } from '../db/repositories/episodeRepo'
import { PodcastRepo } from '../db/repositories/podcastRepo'
import { ImportJobRepo } from '../db/repositories/importJobRepo'
import { fileExtension, fileSize, listFilesRecursive } from '../util/fsHelpers'
import { SUPPORTED_AUDIO_EXTENSIONS } from '@shared/constants'
import type { ImportProgress } from '@shared/types'

export interface ImporterDeps {
  episodes: EpisodeRepo
  podcasts: PodcastRepo
  jobs: ImportJobRepo
  onProgress?: (progress: ImportProgress) => void
}

export interface ImportResult {
  jobId: number
  filesSeen: number
  filesMatched: number
  filesAdded: number
  filesSkipped: number
  cancelled: boolean
}

/**
 * Normalises a title for comparison: lower-cased, punctuation removed and
 * whitespace collapsed. Lets "Radiolab: Colors!" match "radiolab colors".
 */
export function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The episode title guess for a file that has no usable tags. */
export function titleFromFileName(filePath: string): string {
  const ext = extname(filePath)
  return basename(filePath, ext)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** True when the file has an audio extension we support. */
export function isSupportedAudio(filePath: string): boolean {
  return (SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(fileExtension(filePath))
}

export interface FileTags {
  title: string | null
  artist: string | null
  album: string | null
  year: number | null
  duration: number | null
}

/**
 * Lookup tables built once per import.
 *
 * The naive approach queried every podcast for every file - O(files x podcasts)
 * database round-trips, i.e. millions of queries for a large library. These
 * maps turn each lookup into an O(1) hash check.
 */
interface MatchIndex {
  /** `${podcastId}\u0000${normalisedTitle}` -> episode id. */
  byPodcastTitle: Map<string, number>
  /** Normalised title -> episode id, first match wins. */
  byTitle: Map<string, number>
  /** Normalised podcast title -> podcast id. */
  byPodcastName: Map<string, number>
}

/** Reads tags from an audio file, tolerating unreadable or malformed files. */
export async function readTags(filePath: string): Promise<FileTags> {
  try {
    const meta = await parseFile(filePath)
    return {
      title: meta.common.title ?? null,
      artist: meta.common.artist ?? null,
      album: meta.common.album ?? null,
      year: meta.common.year ?? null,
      duration: meta.format.duration ?? null
    }
  } catch {
    return { title: null, artist: null, album: null, year: null, duration: null }
  }
}

/**
 * Imports a legacy on-disk podcast library into the database.
 *
 * Files are matched against existing episodes where possible, so a library
 * that was also subscribed to gains its download state; anything unmatched
 * becomes a new episode under a synthesised podcast.
 */
export class Importer {
  private cancelled = false

  constructor(private readonly deps: ImporterDeps) {}

  cancel(): void {
    this.cancelled = true
  }

  async run(paths: string[]): Promise<ImportResult> {
    this.cancelled = false
    const files: string[] = []
    for (const path of paths) {
      const found = await listFilesRecursive(path, isSupportedAudio)
      files.push(...found)
    }

    const jobId = this.deps.jobs.create(paths[0] ?? 'import')
    const index = this.buildIndex()
    let matched = 0
    let added = 0
    let skipped = 0

    const report = (currentFile: string | null) => {
      this.deps.onProgress?.({
        jobId,
        filesSeen: files.length,
        filesMatched: matched,
        filesAdded: added,
        filesSkipped: skipped,
        currentFile,
        status: 'running'
      })
    }

    for (const file of files) {
      if (this.cancelled) break
      report(file)

      // Already imported?
      if (this.deps.episodes.findByFilePath(file)) {
        skipped += 1
        continue
      }

      const tags = await readTags(file)
      const size = await fileSize(file)
      const title = tags.title || titleFromFileName(file)

      const matchedId = this.findMatch(title, tags, index)
      if (matchedId !== null) {
        this.deps.episodes.attachFile(matchedId, file, size, tags.duration)
        this.consumeMatch(matchedId, title, tags, index)
        matched += 1
      } else {
        const podcastId = this.ensurePodcastForFile(file, tags, index)
        const newId = this.deps.episodes.insertImported({
          podcastId,
          guid: `import:${file}`,
          title,
          description: null,
          descriptionHtml: null,
          mediaUrl: null,
          mediaType: null,
          mediaLength: size,
          durationSecs: tags.duration ? Math.round(tags.duration) : null,
          releaseDate: tags.year ? new Date(tags.year, 0, 1).getTime() : null,
          episodeNumber: null,
          seasonNumber: null,
          artworkUrl: null
        })
        // Make the new row visible to later files in this same run.
        const normalisedNew = normaliseTitle(title)
        if (normalisedNew) {
          if (!index.byTitle.has(normalisedNew)) index.byTitle.set(normalisedNew, newId)
          const scoped = `${podcastId}\u0000${normalisedNew}`
          if (!index.byPodcastTitle.has(scoped)) index.byPodcastTitle.set(scoped, newId)
        }
        added += 1
      }
    }

    const status = this.cancelled ? 'cancelled' : 'completed'
    this.deps.jobs.finish(jobId, { seen: files.length, matched, added, skipped }, status)

    this.deps.onProgress?.({
      jobId,
      filesSeen: files.length,
      filesMatched: matched,
      filesAdded: added,
      filesSkipped: skipped,
      currentFile: null,
      status
    })

    return {
      jobId,
      filesSeen: files.length,
      filesMatched: matched,
      filesAdded: added,
      filesSkipped: skipped,
      cancelled: this.cancelled
    }
  }

  /**
   * Builds the lookup tables used for matching, once per import run.
   */
  private buildIndex(): MatchIndex {
    const byPodcastTitle = new Map<string, number>()
    const byTitle = new Map<string, number>()

    for (const row of this.deps.episodes.listForMatching()) {
      const normalised = normaliseTitle(row.title)
      if (!normalised) continue
      const scoped = `${row.podcastId}\u0000${normalised}`
      if (!byPodcastTitle.has(scoped)) byPodcastTitle.set(scoped, row.id)
      if (!byTitle.has(normalised)) byTitle.set(normalised, row.id)
    }

    const byPodcastName = new Map<string, number>()
    for (const podcast of this.deps.podcasts.list(true)) {
      byPodcastName.set(normaliseTitle(podcast.title), podcast.id)
    }

    return { byPodcastTitle, byTitle, byPodcastName }
  }

  /**
   * Finds an existing episode for a file, in priority order:
   *   1. same title within a podcast whose title matches the album/artist
   *   2. same normalised title within any podcast
   */
  private findMatch(title: string, tags: FileTags, index: MatchIndex): number | null {
    const normalised = normaliseTitle(title)
    if (!normalised) return null

    const showName = tags.album || tags.artist
    if (showName) {
      const podcastId = index.byPodcastName.get(normaliseTitle(showName))
      if (podcastId !== undefined) {
        const scoped = index.byPodcastTitle.get(`${podcastId}\u0000${normalised}`)
        if (scoped !== undefined) return scoped
      }
    }

    return index.byTitle.get(normalised) ?? null
  }

  /** Removes a matched episode from the index so a duplicate file creates a new entry. */
  private consumeMatch(episodeId: number, title: string, tags: FileTags, index: MatchIndex): void {
    const normalised = normaliseTitle(title)
    if (!normalised) return
    if (index.byTitle.get(normalised) === episodeId) {
      index.byTitle.delete(normalised)
    }
    const showName = tags.album || tags.artist
    if (showName) {
      const podcastId = index.byPodcastName.get(normaliseTitle(showName))
      if (podcastId !== undefined) {
        index.byPodcastTitle.delete(`${podcastId}\u0000${normalised}`)
      }
    }
  }

  /**
   * Returns the id of the podcast an unmatched file should belong to,
   * creating a synthesised one when needed.
   */
  private ensurePodcastForFile(filePath: string, tags: FileTags, index: MatchIndex): number {
    const showName = tags.album || tags.artist || basename(dirname(filePath))
    const normalised = normaliseTitle(showName) || 'imported'

    const existing = index.byPodcastName.get(normalised)
    if (existing !== undefined) return existing

    // Imported podcasts have no feed URL, so a stable pseudo-URL is used.
    const created = this.deps.podcasts.create({
      feedUrl: `import://${encodeURIComponent(normalised)}`,
      title: showName,
      author: tags.artist,
      autoDownload: false
    })
    index.byPodcastName.set(normalised, created.id)
    return created.id
  }
}
