import { create } from 'zustand'
import type { Episode } from '@shared/types'

interface EpisodeState {
  episodes: Episode[]
  total: number
  hasMore: boolean
  loading: boolean
  loadingMore: boolean
  error: string | null

  setEpisodes: (episodes: Episode[], total: number, hasMore: boolean) => void
  appendEpisodes: (episodes: Episode[], total: number, hasMore: boolean) => void
  setLoading: (loading: boolean) => void
  setLoadingMore: (loadingMore: boolean) => void
  setError: (error: string | null) => void
  updateEpisode: (episode: Episode) => void
  removeEpisode: (episodeId: number) => void
  clear: () => void
}

export const useEpisodeStore = create<EpisodeState>((set) => ({
  episodes: [],
  total: 0,
  hasMore: false,
  loading: false,
  loadingMore: false,
  error: null,

  setEpisodes: (episodes, total, hasMore) =>
    set({ episodes, total, hasMore, loading: false, error: null }),
  appendEpisodes: (episodes, total, hasMore) =>
    set((state) => ({ episodes: [...state.episodes, ...episodes], total, hasMore })),
  setLoading: (loading) => set({ loading }),
  setLoadingMore: (loadingMore) => set({ loadingMore }),
  setError: (error) => set({ error, loading: false }),
  updateEpisode: (episode) =>
    set((state) => ({
      episodes: state.episodes.map((e) => (e.id === episode.id ? episode : e))
    })),
  removeEpisode: (episodeId) =>
    set((state) => ({
      episodes: state.episodes.filter((e) => e.id !== episodeId),
      total: Math.max(0, state.total - 1)
    })),
  clear: () => set({ episodes: [], total: 0, hasMore: false, error: null })
}))
