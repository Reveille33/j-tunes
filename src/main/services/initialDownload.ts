import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { Podcast } from '@shared/types'

/**
 * Same gate as a feed update: the global "new episodes on update" setting
 * and the per-podcast auto-download flag both have to be on.
 *
 * A podcast created by subscribe defaults the per-podcast flag on, which
 * matches that settings copy.
 */
export function autoDownloadEnabled(
  autoDownloadDefault: boolean,
  podcastAutoDownload: boolean
): boolean {
  return autoDownloadDefault && podcastAutoDownload
}

/** Newest by release date, then by id. A missing date sorts as the oldest. */
export function newestEpisodeId(
  episodes: { id: number; releaseDate: number | null }[]
): number | null {
  let best: { id: number; releaseDate: number | null } | null = null
  for (const episode of episodes) {
    if (!best || isNewer(episode, best)) best = episode
  }
  return best?.id ?? null
}

function isNewer(
  candidate: { id: number; releaseDate: number | null },
  current: { id: number; releaseDate: number | null }
): boolean {
  const candidateDate = candidate.releaseDate ?? 0
  const currentDate = current.releaseDate ?? 0
  if (candidateDate !== currentDate) return candidateDate > currentDate
  return candidate.id > current.id
}

/**
 * Queues a single episode when a podcast is first subscribed.
 *
 * The whole back catalog is stored, but only the newest episode is
 * downloaded. Later updates still queue every episode that is new since
 * the last check.
 */
export function queueNewestSubscribedEpisode(input: {
  podcast: Pick<Podcast, 'autoDownload'>
  autoDownloadDefault: boolean
  episodeIds: number[]
  episodes: Pick<EpisodeRepo, 'getById'>
  enqueue: (episodeId: number) => void
}): void {
  if (!autoDownloadEnabled(input.autoDownloadDefault, input.podcast.autoDownload)) return

  const dated = []
  for (const id of input.episodeIds) {
    const row = input.episodes.getById(id)
    if (row) dated.push({ id: row.id, releaseDate: row.release_date })
  }

  const episodeId = newestEpisodeId(dated)
  if (episodeId == null) return
  try {
    input.enqueue(episodeId)
  } catch {
    // An episode without a media URL cannot be downloaded.
  }
}
