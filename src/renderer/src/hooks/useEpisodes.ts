import { useCallback, useEffect, useRef } from 'react'
import { useEpisodeStore } from '../state/episodeStore'
import { useUiStore } from '../state/uiStore'
import { MAX_LOADED_EPISODES, PAGE_SIZE, SEARCH_DEBOUNCE_MS } from '@shared/constants'
import type { EpisodeQuery } from '@shared/types'

/**
 * Loads episodes for the current filters, sort and search term.
 *
 * The search term is debounced so typing does not fire a query per
 * keystroke, and results are fetched in pages so a 50k-episode library
 * never sends more than the renderer can hold.
 */
export function useEpisodes(): {
  refresh: () => Promise<void>
  loadMore: () => Promise<void>
} {
  const searchTerm = useUiStore((s) => s.searchTerm)
  const sortBy = useUiStore((s) => s.sortBy)
  const direction = useUiStore((s) => s.direction)
  const viewFilter = useUiStore((s) => s.viewFilter)
  const year = useUiStore((s) => s.year)
  const descriptionTerm = useUiStore((s) => s.descriptionTerm)
  const selectedPodcastId = useUiStore((s) => s.selectedPodcastId)

  const requestId = useRef(0)

  const buildQuery = useCallback(
    (offset: number): EpisodeQuery => ({
      filters: {
        text: searchTerm.trim() || null,
        podcastId: selectedPodcastId,
        year,
        played: viewFilter === 'unplayed' ? false : null,
        downloadState: viewFilter === 'downloaded' ? 'done' : null,
        descriptionTerm: descriptionTerm.trim() || null
      },
      sortBy: searchTerm.trim() ? 'relevance' : sortBy,
      direction,
      limit: PAGE_SIZE,
      offset
    }),
    [
      searchTerm,
      selectedPodcastId,
      year,
      viewFilter,
      descriptionTerm,
      sortBy,
      direction
    ]
  )

  const refresh = useCallback(async () => {
    const id = ++requestId.current
    const store = useEpisodeStore.getState()
    store.setLoading(true)

    try {
      const page = await window.api.queryEpisodes(buildQuery(0))
      // Ignore a response that a newer request has superseded.
      if (id !== requestId.current) return
      useEpisodeStore.getState().setEpisodes(page.rows, page.total, page.hasMore)
    } catch (error) {
      if (id !== requestId.current) return
      useEpisodeStore.getState().setError((error as Error).message)
    }
  }, [buildQuery])

  const loadMore = useCallback(async () => {
    const store = useEpisodeStore.getState()
    if (!store.hasMore || store.loadingMore) return
    if (store.episodes.length >= MAX_LOADED_EPISODES) return

    store.setLoadingMore(true)
    try {
      const page = await window.api.queryEpisodes(buildQuery(store.episodes.length))
      useEpisodeStore.getState().appendEpisodes(page.rows, page.total, page.hasMore)
    } catch {
      // A failed page load leaves the already-loaded rows intact.
    } finally {
      useEpisodeStore.getState().setLoadingMore(false)
    }
  }, [buildQuery])

  // Re-query when the search term settles.
  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh()
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [refresh])

  return { refresh, loadMore }
}
