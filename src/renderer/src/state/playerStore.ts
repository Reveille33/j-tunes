import { create } from 'zustand'

interface PlayerState {
  episodeId: number | null
  episodeTitle: string
  podcastTitle: string
  playing: boolean
  position: number
  duration: number
  buffered: number
  rate: number
  volume: number
  muted: boolean
  /** True while the source is being loaded. */
  loading: boolean
  error: string | null
  /** Epoch ms at which playback should auto-pause, or null when off. */
  sleepAt: number | null

  setEpisode: (episodeId: number | null, title: string, podcastTitle: string) => void
  setPlaying: (playing: boolean) => void
  setPosition: (position: number) => void
  setDuration: (duration: number) => void
  setBuffered: (buffered: number) => void
  setRate: (rate: number) => void
  setVolume: (volume: number) => void
  setMuted: (muted: boolean) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  setSleepAt: (sleepAt: number | null) => void
  reset: () => void
}

export const usePlayerStore = create<PlayerState>((set) => ({
  episodeId: null,
  episodeTitle: '',
  podcastTitle: '',
  playing: false,
  position: 0,
  duration: 0,
  buffered: 0,
  rate: 1,
  volume: 1,
  muted: false,
  loading: false,
  error: null,
  sleepAt: null,

  setEpisode: (episodeId, episodeTitle, podcastTitle) =>
    set({
      episodeId,
      episodeTitle,
      podcastTitle,
      position: 0,
      duration: 0,
      buffered: 0,
      error: null
    }),
  setPlaying: (playing) => set({ playing }),
  setPosition: (position) => set({ position }),
  setDuration: (duration) => set({ duration }),
  setBuffered: (buffered) => set({ buffered }),
  setRate: (rate) => set({ rate }),
  setVolume: (volume) => set({ volume }),
  setMuted: (muted) => set({ muted }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setSleepAt: (sleepAt) => set({ sleepAt }),
  reset: () =>
    set({
      episodeId: null,
      episodeTitle: '',
      podcastTitle: '',
      playing: false,
      position: 0,
      duration: 0,
      buffered: 0,
      error: null
    })
}))
