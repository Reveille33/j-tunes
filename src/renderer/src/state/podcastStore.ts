import { create } from 'zustand'
import type { Podcast } from '@shared/types'

interface PodcastState {
  podcasts: Podcast[]
  years: number[]
  loading: boolean
  error: string | null

  setPodcasts: (podcasts: Podcast[]) => void
  setYears: (years: number[]) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  updatePodcast: (podcast: Podcast) => void
  removePodcast: (podcastId: number) => void
}

export const usePodcastStore = create<PodcastState>((set) => ({
  podcasts: [],
  years: [],
  loading: false,
  error: null,

  setPodcasts: (podcasts) => set({ podcasts, loading: false, error: null }),
  setYears: (years) => set({ years }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  updatePodcast: (podcast) =>
    set((state) => ({
      podcasts: state.podcasts.map((p) => (p.id === podcast.id ? podcast : p))
    })),
  removePodcast: (podcastId) =>
    set((state) => ({
      podcasts: state.podcasts.filter((p) => p.id !== podcastId)
    }))
}))
