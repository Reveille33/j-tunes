import { episodeMenuTargets, playlistAddedMessage } from '@shared/playlistMenu'
import type { PlaylistAddInput } from '@shared/validation'
import { usePlaylistStore } from './state/playlistStore'
import { useUiStore } from './state/uiStore'

/** Opens the native Add to playlist menu for the clicked episode. */
export function openEpisodePlaylistMenu(clickedId: number, selectedIds: Iterable<number>): void {
  const episodeIds = episodeMenuTargets(clickedId, selectedIds)
  void window.api.showEpisodeMenu(episodeIds).catch((error: Error) => {
    useUiStore.getState().showToast(error.message, 'error')
  })
}

/** Writes the playlist add and toasts how many episodes were new. */
export async function commitPlaylistAdd(input: PlaylistAddInput): Promise<void> {
  try {
    const result = await window.api.addToPlaylist(input)
    useUiStore.getState().showToast(
      playlistAddedMessage(result.playlist.name, result.added, result.skipped),
      result.added > 0 ? 'success' : 'info'
    )
    await usePlaylistStore.getState().load()
    if (useUiStore.getState().selectedPlaylistId === result.playlist.id) {
      await usePlaylistStore.getState().loadEpisodes(result.playlist.id)
    }
  } catch (error) {
    useUiStore.getState().showToast((error as Error).message, 'error')
  }
}
