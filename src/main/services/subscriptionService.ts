import { canonicaliseFeedUrl, fetchFeed, FeedError } from './feedService'
import type { EpisodeRepo } from '../db/repositories/episodeRepo'
import type { PodcastRepo } from '../db/repositories/podcastRepo'
import type { Podcast } from '@shared/types'

export interface SubscriptionDeps {
  podcasts: PodcastRepo
  episodes: EpisodeRepo
}

/**
 * Subscribes to a feed: fetch it, create the podcast and store its episodes.
 *
 * Returns the ids of the episodes that were genuinely new so the caller can
 * decide whether to auto-download them. Throws a `FeedError` when the feed is
 * already subscribed to or cannot be fetched.
 */
export async function subscribeToFeed(
  deps: SubscriptionDeps,
  feedUrl: string
): Promise<{ podcast: Podcast; newEpisodeIds: number[] }> {
  const canonical = canonicaliseFeedUrl(feedUrl)

  const existing = deps.podcasts.getByFeedUrl(canonical)
  if (existing) {
    throw new FeedError(`Already subscribed to "${existing.title}"`)
  }

  const result = await fetchFeed(canonical)
  if (!result.feed) throw new FeedError('Feed returned no content')

  const feed = result.feed
  const podcast = deps.podcasts.create({
    feedUrl: canonical,
    title: feed.title || 'Unknown podcast',
    author: feed.author,
    description: feed.description,
    descriptionHtml: feed.descriptionHtml,
    artworkUrl: feed.artworkUrl,
    category: feed.category,
    language: feed.language,
    link: feed.link
  })

  deps.podcasts.updateMeta(podcast.id, {
    etag: result.etag,
    lastModified: result.lastModified
  })

  const newEpisodeIds = deps.episodes.insertMany(podcast.id, feed.episodes)
  deps.podcasts.refreshCounters(podcast.id)

  return { podcast: deps.podcasts.getById(podcast.id)!, newEpisodeIds }
}