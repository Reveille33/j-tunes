import { useEffect, useState } from 'react'
import { useUiStore } from '../../state/uiStore'
import { usePodcastStore } from '../../state/podcastStore'
import { useEscapeKey } from '../../hooks/useEscapeKey'
import type { FeedSearchResult } from '@shared/types'

interface AddPodcastDialogProps {
  onClose: () => void
  onSubscribed?: () => void
}

/**
 * Subscribe to a podcast, either by pasting a feed URL or by searching the
 * built-in directory.
 */
export function AddPodcastDialog({ onClose, onSubscribed }: AddPodcastDialogProps): React.JSX.Element {
  const setPodcasts = usePodcastStore((s) => s.setPodcasts)
  const podcasts = usePodcastStore((s) => s.podcasts)
  const showToast = useUiStore((s) => s.showToast)

  const [feedUrl, setFeedUrl] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [results, setResults] = useState<FeedSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEscapeKey(onClose, !subscribing)

  // Debounced directory search.
  useEffect(() => {
    const term = searchTerm.trim()
    if (!term) {
      setResults([])
      return
    }

    let cancelled = false
    setSearching(true)

    const timer = setTimeout(async () => {
      try {
        const found = await window.api.searchFeed(term, 25)
        if (!cancelled) setResults(found)
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [searchTerm])

  const subscribe = async (url: string) => {
    setSubscribing(true)
    setError(null)
    try {
      const podcast = await window.api.subscribe(url)
      setPodcasts([...podcasts, podcast])
      showToast(`Subscribed to "${podcast.title}"`, 'success')
      onSubscribed?.()
      onClose()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSubscribing(false)
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <div className="dialog-header">
          <h2>Add a podcast</h2>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="dialog-body">
          <div className="dialog-section">
            <label className="dialog-label" htmlFor="feed-url">
              Feed URL
            </label>
            <div className="dialog-row">
              <input
                id="feed-url"
                className="dialog-input"
                type="url"
                placeholder="https://example.com/feed.xml"
                value={feedUrl}
                onChange={(event) => setFeedUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && feedUrl.trim()) void subscribe(feedUrl.trim())
                }}
              />
              <button
                className="button button-primary"
                disabled={!feedUrl.trim() || subscribing}
                onClick={() => void subscribe(feedUrl.trim())}
              >
                {subscribing ? 'Subscribing…' : 'Subscribe'}
              </button>
            </div>
          </div>

          <div className="dialog-divider">
            <span>or search</span>
          </div>

          <div className="dialog-section">
            <input
              className="dialog-input"
              type="search"
              placeholder="Search for a podcast…"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              aria-label="Search the podcast directory"
            />

            {searching ? <p className="dialog-hint">Searching…</p> : null}

            {!searching && results.length > 0 ? (
              <ul className="feed-results">
                {results.map((result) => (
                  <li key={result.feedUrl}>
                    <button
                      className="feed-result"
                      onClick={() => void subscribe(result.feedUrl)}
                      disabled={subscribing}
                    >
                      {result.artworkUrl ? (
                        <img className="feed-result-art" src={result.artworkUrl} alt="" />
                      ) : (
                        <div className="feed-result-art feed-result-art-placeholder" />
                      )}
                      <div className="feed-result-text">
                        <div className="feed-result-title truncate">{result.title}</div>
                        <div className="feed-result-meta truncate">
                          {result.author ?? 'Unknown author'}
                          {result.category ? ` · ${result.category}` : ''}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {!searching && searchTerm.trim() && results.length === 0 ? (
              <p className="dialog-hint">No podcasts found for “{searchTerm.trim()}”.</p>
            ) : null}
          </div>

          {error ? <div className="dialog-error">{error}</div> : null}
        </div>
      </div>
    </div>
  )
}
