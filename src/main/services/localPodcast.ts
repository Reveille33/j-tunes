import { realpath } from 'node:fs/promises'
import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { PodcastFolderRepo } from '../db/repositories/podcastFolderRepo'
import type { PodcastRepo } from '../db/repositories/podcastRepo'
import type { Podcast, ScanProgress } from '@shared/types'
import { scanPodcastFolders } from './folderScan'

export interface LocalPodcastDeps {
  podcasts: PodcastRepo
  folders: PodcastFolderRepo
  episodes: EpisodeRepo
  onProgress?: (progress: ScanProgress) => void
}

/**
 * Creates a show with no feed, links one folder, and scans it immediately.
 *
 * The folder row is the only thing removed if linking fails. Files on disk
 * are never deleted.
 */
export async function addLocalPodcast(
  deps: LocalPodcastDeps,
  input: { title: string; path: string }
): Promise<Podcast> {
  const title = input.title.trim()
  if (!title) throw new Error('Name is required')

  let stored = input.path
  try {
    stored = await realpath(input.path)
  } catch {
    stored = input.path
  }

  const podcast = deps.podcasts.create({
    feedUrl: null,
    title,
    autoDownload: false
  })

  try {
    deps.folders.add(podcast.id, stored)
  } catch (error) {
    deps.podcasts.remove(podcast.id)
    throw error
  }

  const scan = await scanPodcastFolders(deps, podcast.id)
  const folderError =
    scan.missing.length > 0 ? `Folder not found: ${scan.missing.join(', ')}` : null
  deps.podcasts.setLastError(podcast.id, folderError ? folderError.slice(0, 500) : null)
  deps.podcasts.setChecked(podcast.id, null, null)

  return deps.podcasts.getById(podcast.id)!
}
