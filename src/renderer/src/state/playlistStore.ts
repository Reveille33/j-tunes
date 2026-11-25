import { create } from 'zustand'
import type { Episode, PlaylistSummary } from '@shared/types'
import { useUiStore } from './uiStore'

let episodeRequest = 0

interface PlaylistState {
  playlists: PlaylistSummary[]
  episodes: Episode[]
  /** Playlist whose `episodes` were last requested. */
  openId: number | null
  loading: boolean

  load: () => Promise<void>
  loadEpisodes: (playlistId: number) => Promise<void>
  removeEpisode: (playlistId: number, episodeId: number) => Promise<void>
}

/**
 * Saved playlists and the episodes of the one currently open.
 *
 * The main process owns membership and order. This store is refreshed after
 * every add or remove so the sidebar and the playlist page agree.
 */
export const usePlaylistStore = create<PlaylistState>((set, get) => ({
  playlists: [],
  episodes: [],
  openId: null,
  loading: false,

  load: async () => {
    try {
      const playlists = await window.api.listPlaylists()
      set({ playlists })
    } catch (error) {
      useUiStore.getState().showToast((error as Error).message, 'error')
    }
  },

  loadEpisodes: async (playlistId) => {
    const request = ++episodeRequest
    set({ loading: true, episodes: [], openId: playlistId })
    try {
      const detail = await window.api.getPlaylist(playlistId)
      if (request !== episodeRequest || useUiStore.getState().selectedPlaylistId !== playlistId) return
      set((state) => ({
        loading: false,
        episodes: detail.episodes,
        playlists: state.playlists.map((playlist) =>
          playlist.id === detail.playlist.id ? detail.playlist : playlist
        )
      }))
    } catch (error) {
      if (request !== episodeRequest) return
      if (useUiStore.getState().selectedPlaylistId === playlistId) {
        useUiStore.getState().showToast((error as Error).message, 'error')
        useUiStore.getState().selectPlaylist(null)
      }
      set({ loading: false, episodes: [] })
    }
  },

  removeEpisode: async (playlistId, episodeId) => {
    const name = get().playlists.find((playlist) => playlist.id === playlistId)?.name
    try {
      await window.api.removeFromPlaylist(playlistId, episodeId)
      await get().load()
      if (useUiStore.getState().selectedPlaylistId === playlistId) {
        await get().loadEpisodes(playlistId)
      }
      useUiStore.getState().showToast(`Removed from ${name ?? 'playlist'}`, 'success')
    } catch (error) {
      useUiStore.getState().showToast((error as Error).message, 'error')
    }
  }
}))
