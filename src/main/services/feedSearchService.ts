import { FEED_LOOKUP_ENDPOINT, FEED_SEARCH_ENDPOINT } from '@shared/constants'
import type { FeedSearchResult } from '@shared/types'

interface ITunesResult {
  collectionId?: number
  collectionName?: string
  artistName?: string
  feedUrl?: string
  artworkUrl600?: string
  artworkUrl100?: string
  artworkUrl60?: string
  primaryGenreName?: string
  trackCount?: number
  releaseDate?: string
}

interface ITunesResponse {
  resultCount?: number
  results?: ITunesResult[]
}

/**
 * Searches the public iTunes podcast directory.
 *
 * This is the "built-in search" for finding a podcast to subscribe to. It
 * needs no API key, and returns the feed URL for each result.
 */
export async function searchFeeds(query: string, limit = 25): Promise<FeedSearchResult[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const url = new URL(FEED_SEARCH_ENDPOINT)
  url.searchParams.set('media', 'podcast')
  url.searchParams.set('entity', 'podcast')
  url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 50)))
  url.searchParams.set('term', trimmed)

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'j-Tunes/0.1 (+https://github.com/j-tunes)' }
  })

  if (!response.ok) {
    throw new Error(`Feed search failed with status ${response.status}`)
  }

  const data = (await response.json()) as ITunesResponse
  const results = data.results ?? []

  return results
    .filter((item) => Boolean(item.feedUrl))
    .map((item) => ({
      feedUrl: item.feedUrl!,
      title: item.collectionName ?? 'Unknown podcast',
      author: item.artistName ?? null,
      artworkUrl: item.artworkUrl100 ?? item.artworkUrl60 ?? item.artworkUrl600 ?? null,
      category: item.primaryGenreName ?? null,
      episodeCount: item.trackCount ?? null
    }))
}

/**
 * Looks up the feed URL for a podcast by its iTunes collection id.
 * Used when the user picks a result from the directory.
 */
export async function lookupFeedUrl(collectionId: number): Promise<string | null> {
  const url = new URL(FEED_LOOKUP_ENDPOINT)
  url.searchParams.set('id', String(collectionId))
  url.searchParams.set('entity', 'podcast')

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'j-Tunes/0.1 (+https://github.com/j-tunes)' }
  })

  if (!response.ok) return null

  const data = (await response.json()) as ITunesResponse
  return data.results?.[0]?.feedUrl ?? null
}
