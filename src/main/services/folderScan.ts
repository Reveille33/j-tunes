import { realpath } from 'node:fs/promises'
import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { PodcastFolderRepo } from '../db/repositories/podcastFolderRepo'
import type { PodcastRepo } from '../db/repositories/podcastRepo'
import { fileSize, listFilesRecursive, pathExists } from '../util/fsHelpers'
import {
  isSupportedAudio,
  normaliseTitle,
  readTags,
  releaseDateForPath,
  titleFromFileName
} from './importer'

export interface FolderScanDeps {
  episodes: EpisodeRepo
  folders: PodcastFolderRepo
  podcasts: PodcastRepo
}

export interface FolderScanResult {
  added: number
  matched: number
  missing: string[]
}

/** True only for a real RSS feed. `import://` and a null feed are not fetched. */
export function feedIsHttp(feedUrl: string | null): boolean {
  return feedUrl != null && /^https?:\/\//i.test(feedUrl)
}

/**
 * Reads one podcast's folders and attaches or adds episodes.
 *
 * Matching stays inside this podcast: an existing file path is skipped, a
 * normalised title fills an episode that has no file yet, and anything else
 * becomes a new imported episode. A missing folder is reported and nothing
 * is deleted.
 */
export async function scanPodcastFolders(
  deps: FolderScanDeps,
  podcastId: number
): Promise<FolderScanResult> {
  const result: FolderScanResult = { added: 0, matched: 0, missing: [] }
  const folders = deps.folders.list(podcastId)
  if (folders.length === 0) return result

  const openByTitle = new Map<string, number>()
  for (const episode of deps.episodes.listForFolderMatch(podcastId)) {
    if (episode.filePath) continue
    const key = normaliseTitle(episode.title)
    if (key && !openByTitle.has(key)) openByTitle.set(key, episode.id)
  }

  for (const folder of folders) {
    if (!(await pathExists(folder.path))) {
      result.missing.push(folder.path)
      continue
    }

    const files = await listFilesRecursive(folder.path, isSupportedAudio)
    for (const file of files) {
      let real = file
      try {
        real = await realpath(file)
      } catch {
        continue
      }

      const tags = await readTags(real)
      const title = tags.title || titleFromFileName(real)
      const size = await fileSize(real)
      const release = await releaseDateForPath(real, tags)
      const existing = deps.episodes.findByFilePath(real) ?? deps.episodes.findByFilePath(file)
      if (existing) {
        if (release) deps.episodes.upgradeReleaseDate(existing.id, release)
        continue
      }

      const key = normaliseTitle(title)
      const matchId = key ? openByTitle.get(key) : undefined
      const duration = tags.duration != null ? Math.round(tags.duration) : null

      if (matchId != null) {
        deps.episodes.attachFile(matchId, real, size, duration)
        if (release) deps.episodes.upgradeReleaseDate(matchId, release)
        openByTitle.delete(key)
        result.matched += 1
        continue
      }

      deps.episodes.insertImported({
        podcastId,
        guid: `file:${real}`,
        title: title || 'Untitled',
        description: null,
        descriptionHtml: null,
        mediaUrl: null,
        mediaType: null,
        mediaLength: size,
        durationSecs: duration,
        releaseDate: release?.timestamp ?? null,
        releasePrecision: release?.precision ?? null,
        episodeNumber: null,
        seasonNumber: null,
        artworkUrl: null,
        filePath: real,
        fileSize: size
      })
      result.added += 1
    }
  }

  if (result.added > 0 || result.matched > 0) deps.podcasts.refreshCounters(podcastId)
  return result
}
