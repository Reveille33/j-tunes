import { parseFeed } from './feedParser'
import { FEED_TIMEOUT_MS, MAX_FEED_BYTES } from '@shared/constants'
import { fetchHttp, readTextLimited } from '../util/http'
import type { ParsedFeed } from '@shared/types'

export interface FetchFeedOptions {
  etag?: string | null
  lastModified?: string | null
  timeoutMs?: number
}

export interface FetchFeedResult {
  /** True when the server answered 304 and the feed is unchanged. */
  notModified: boolean
  feed: ParsedFeed | null
  etag: string | null
  lastModified: string | null
}

export class FeedError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message)
    this.name = 'FeedError'
  }
}

/**
 * Normalises a feed URL so the same feed subscribed twice is detected as a
 * duplicate: lower-cased host, no `www.`, no trailing slash, no fragment,
 * and always `https` (with an automatic `http` fallback at fetch time).
 */
export function canonicaliseFeedUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) throw new FeedError('Feed URL is empty')

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`

  let url: URL
  try {
    url = new URL(withProtocol)
  } catch {
    throw new FeedError(`Invalid feed URL: ${input}`)
  }

  if (!/^https?:$/.test(url.protocol)) {
    throw new FeedError(`Unsupported protocol: ${url.protocol}`)
  }

  // Always canonicalise to https so an http:// and an https:// copy of the
  // same feed are recognised as one subscription.
  url.protocol = 'https:'
  url.hash = ''
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  // Keep a meaningful query string (some feeds use it for the feed id) but
  // drop a trailing slash on the path.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }

  return url.toString()
}

/** Builds the plain-http variant of a canonical feed URL. */
export function httpFallbackUrl(canonicalUrl: string): string {
  return canonicalUrl.replace(/^https:/i, 'http:')
}

/** Performs a single feed HTTP request. Redirects to non-http schemes fail. */
async function requestFeed(
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
): Promise<Response> {
  return fetchHttp(url, { headers, signal })
}

/**
 * Fetches and parses a feed, using conditional GET when the caller has
 * stored ETag / Last-Modified values. A 304 response avoids re-parsing
 * the XML entirely, which is what keeps a large-library check fast.
 */
export async function fetchFeed(
  feedUrl: string,
  options: FetchFeedOptions = {}
): Promise<FetchFeedResult> {
  const controller = new AbortController()
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? FEED_TIMEOUT_MS
  )

  const headers: Record<string, string> = {
    'User-Agent': 'j-Tunes/0.1 (+https://github.com/j-tunes)',
    Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8'
  }
  if (options.etag) headers['If-None-Match'] = options.etag
  if (options.lastModified) headers['If-Modified-Since'] = options.lastModified

  try {
    let response: Response
    try {
      response = await requestFeed(feedUrl, headers, controller.signal)
    } catch (error) {
      if (feedUrl.startsWith('https:') && (error as Error).name !== 'AbortError') {
        response = await requestFeed(httpFallbackUrl(feedUrl), headers, controller.signal)
      } else {
        throw error
      }
    }

    // A feed that only serves plain http is retried over http before the
    // failure is reported to the user.
    if (!response.ok && response.status !== 304 && feedUrl.startsWith('https:')) {
      try {
        const fallback = await requestFeed(httpFallbackUrl(feedUrl), headers, controller.signal)
        if (fallback.ok || fallback.status === 304) {
          response = fallback
        }
      } catch {
        // Keep the original response.
      }
    }

    if (response.status === 304) {
      return {
        notModified: true,
        feed: null,
        etag: options.etag ?? null,
        lastModified: options.lastModified ?? null
      }
    }

    if (!response.ok) {
      throw new FeedError(
        `Feed request failed with status ${response.status}`,
        response.status
      )
    }

    const xml = await readTextLimited(response, MAX_FEED_BYTES)
    const feed = parseFeed(xml)

    return {
      notModified: false,
      feed,
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified')
    }
  } catch (error) {
    if (error instanceof FeedError) throw error
    if ((error as Error).name === 'AbortError') {
      throw new FeedError(`Feed request timed out after ${options.timeoutMs ?? FEED_TIMEOUT_MS}ms`)
    }
    throw new FeedError((error as Error).message)
  } finally {
    clearTimeout(timeout)
  }
}
