import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useEpisodeStore } from '../../state/episodeStore'
import { EpisodeRow } from './EpisodeRow'
import type { Episode } from '@shared/types'

interface EpisodeListProps {
  onPlay: (episode: Episode) => void
  onLoadMore: () => void
}

/**
 * The episode list.
 *
 * Rows are virtualised so only the visible window is in the DOM, which keeps
 * scrolling smooth with tens of thousands of episodes. The next page is
 * fetched when the user scrolls near the end of the loaded rows.
 */
export function EpisodeList({ onPlay, onLoadMore }: EpisodeListProps): React.JSX.Element {
  const episodes = useEpisodeStore((s) => s.episodes)
  const total = useEpisodeStore((s) => s.total)
  const loading = useEpisodeStore((s) => s.loading)
  const loadingMore = useEpisodeStore((s) => s.loadingMore)
  const hasMore = useEpisodeStore((s) => s.hasMore)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** Index of the row that currently owns the list's single tab stop. */
  const [focusedIndex, setFocusedIndex] = useState(0)

  const virtualizer = useVirtualizer({
    count: episodes.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 72,
    overscan: 12,
    getItemKey: (index) => episodes[index]?.id ?? index
  })

  const virtualItems = virtualizer.getVirtualItems()

  // Keep the roving tab stop inside the list as data changes.
  useEffect(() => {
    setFocusedIndex((index) => Math.min(index, Math.max(0, episodes.length - 1)))
  }, [episodes.length])

  /**
   * Arrow-key navigation across rows (roving tabindex).
   *
   * Only rows themselves handle these keys, so the inner buttons keep their
   * normal Tab behaviour. `scrollToIndex` runs first so the target row exists
   * by the time focus is applied on the next frame.
   */
  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement
    if (target.dataset.row !== 'true') return

    const last = episodes.length - 1
    if (last < 0) return
    const current = Number(target.dataset.index ?? '0')

    if (event.key === 'Enter') {
      const episode = episodes[current]
      if (episode) {
        event.preventDefault()
        onPlay(episode)
      }
      return
    }

    let next: number | null = null
    if (event.key === 'ArrowDown') next = Math.min(last, current + 1)
    else if (event.key === 'ArrowUp') next = Math.max(0, current - 1)
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = last
    if (next === null) return

    event.preventDefault()
    setFocusedIndex(next)
    virtualizer.scrollToIndex(next, { align: 'auto' })
    window.requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.focus()
    })
  }

  // Fetch the next page when the user approaches the end of the list.
  useEffect(() => {
    const last = virtualItems[virtualItems.length - 1]
    if (!last) return
    if (last.index >= episodes.length - 5 && hasMore && !loadingMore) {
      onLoadMore()
    }
  }, [virtualItems, episodes.length, hasMore, loadingMore, onLoadMore])

  if (loading && episodes.length === 0) {
    return (
      <div className="list-placeholder">
        <div className="spinner" />
        <p>Loading episodes…</p>
      </div>
    )
  }

  if (episodes.length === 0) {
    return (
      <div className="list-placeholder">
        <h3>No episodes yet</h3>
        <p>
          Subscribe to a podcast, or import your existing library from the sidebar, to get
          started.
        </p>
      </div>
    )
  }

  return (
    <div
      className="episode-list"
      ref={scrollRef}
      role="list"
      onKeyDown={handleKeyDown}
      data-testid="episode-list"
    >
      <div
        className="episode-list-inner"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualItems.map((virtualRow) => {
          const episode = episodes[virtualRow.index]
          if (!episode) return null
          return (
            <div
              key={virtualRow.key}
              ref={virtualizer.measureElement}
              className="episode-list-row"
              role="listitem"
              data-row="true"
              data-index={virtualRow.index}
              tabIndex={virtualRow.index === focusedIndex ? 0 : -1}
              onFocus={() => setFocusedIndex(virtualRow.index)}
              style={{
                transform: `translateY(${virtualRow.start}px)`
              }}
            >
              <EpisodeRow episode={episode} onPlay={onPlay} />
            </div>
          )
        })}
      </div>

      <div className="episode-list-footer">
        {loadingMore ? (
          <span>Loading more…</span>
        ) : (
          <span>
            Showing {episodes.length.toLocaleString()} of {total.toLocaleString()} episodes
          </span>
        )}
      </div>
    </div>
  )
}
